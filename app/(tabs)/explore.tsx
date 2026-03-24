import React, { useEffect, useState } from 'react';
import { StyleSheet, FlatList, View, Text, RefreshControl, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@/utils/supabase';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { getStatusColor } from '@/constants/thresholds';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';

interface GasLog {
  id: number;
  created_at: string;
  ppm_level: number;
  status: string;
  device_mac: string;
}

export default function HistoryScreen() {
  const [logs, setLogs] = useState<GasLog[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Confirmation Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [deleteType, setDeleteType] = useState<'selected' | 'all'>('selected');

  // Theme Colors
  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const cardColor = useThemeColor({ light: '#fff', dark: '#1e1e1e' }, 'background');
  const headerBg = useThemeColor({}, 'background');
  const shadowColor = useThemeColor({ light: '#000', dark: '#000' }, 'text');

  const fetchLogs = async () => {
    setRefreshing(true);
    const { data, error } = await supabase
      .from('gas_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error fetching logs:', error);
    } else {
      setLogs(data || []);
    }
    setRefreshing(false);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const toggleSelection = (id: number) => {
    if (!isSelectionMode) {
      setIsSelectionMode(true);
      setSelectedIds([id]);
      return;
    }

    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleLongPress = (id: number) => {
    setIsSelectionMode(true);
    toggleSelection(id);
  };

  const confirmDelete = (type: 'selected' | 'all') => {
    if (type === 'selected' && selectedIds.length === 0) return;
    setDeleteType(type);
    setShowConfirmModal(true);
  };

  const executeDelete = async () => {
    setShowConfirmModal(false);
    setIsDeleting(true);

    try {
      if (deleteType === 'all') {
        const { error } = await supabase
          .from('gas_logs')
          .delete()
          .neq('id', 0); // Delete all where ID != 0 (everything)
        
        if (error) throw error;
        setLogs([]);
      } else {
        const { error } = await supabase
          .from('gas_logs')
          .delete()
          .in('id', selectedIds);
        
        if (error) throw error;
        setLogs(prev => prev.filter(log => !selectedIds.includes(log.id)));
      }
      
      setIsSelectionMode(false);
      setSelectedIds([]);
      Alert.alert('Success', 'History updated successfully.');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to delete logs.');
    } finally {
      setIsDeleting(false);
    }
  };

  const cancelSelection = () => {
    setIsSelectionMode(false);
    setSelectedIds([]);
  };

  const renderItem = ({ item }: { item: GasLog }) => {
    const isSelected = selectedIds.includes(item.id);
    const statusColor = getStatusColor(item.status);

    return (
      <TouchableOpacity 
        style={[
          styles.logItem, 
          { backgroundColor: cardColor, shadowColor },
          isSelected && styles.selectedItem,
          { borderLeftColor: statusColor, borderLeftWidth: 6 }
        ]}
        onPress={() => isSelectionMode ? toggleSelection(item.id) : null}
        onLongPress={() => handleLongPress(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.logHeader}>
          <Text style={styles.logTime}>
            {new Date(item.created_at).toLocaleString()}
          </Text>
          {isSelectionMode && (
            <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
              <IconSymbol name="checkmark" size={12} color="#fff" />
            </View>
          )}
          {!isSelectionMode && <View style={[styles.statusDot, { backgroundColor: statusColor }]} />}
        </View>
        <View style={styles.logBody}>
          <View>
            <Text style={[styles.logPpm, { color: textColor }]}>{item.ppm_level} <Text style={styles.ppmLabel}>PPM</Text></Text>
            <Text style={styles.logMac}>DEVICE: {item.device_mac}</Text>
          </View>
          <Text style={[styles.logStatus, { color: statusColor }]}>{item.status.toUpperCase()}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: headerBg }]}>
      <StatusBar style="auto" />
      <ThemedView style={[styles.container, { backgroundColor }]}>
        <View style={[styles.header, { backgroundColor: headerBg, shadowColor }]}>
          <View>
            <ThemedText type="title" style={[styles.title, { color: textColor }]}>History</ThemedText>
            <Text style={styles.subtitle}>Manage your gas detection logs</Text>
          </View>
          
          {!isSelectionMode && (
            <TouchableOpacity style={[styles.clearAllBtn, { backgroundColor: cardColor, shadowColor }]} onPress={() => confirmDelete('all')}>
              <Text style={styles.clearAllText}>Clear All</Text>
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          data={logs}
          renderItem={renderItem}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={fetchLogs} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <IconSymbol name="clock.fill" size={50} color="#ccc" />
              <Text style={styles.emptyText}>No history logs found.</Text>
            </View>
          }
        />

        {isSelectionMode && (
          <View style={[styles.selectionBar, { backgroundColor: cardColor, shadowColor }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[styles.selectionCount, { color: textColor }]}>{selectedIds.length} selected</Text>
            </View>
            
            <View style={styles.selectionBarActions}>
              <TouchableOpacity 
                style={[styles.deleteBtn, selectedIds.length === 0 && styles.disabledBtn]} 
                onPress={() => confirmDelete('selected')}
                disabled={selectedIds.length === 0}
              >
                <IconSymbol name="trash.fill" size={18} color="#fff" />
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.selectionCancelBtn} onPress={cancelSelection}>
                <Text style={styles.selectionCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Confirmation Modal */}
        <Modal visible={showConfirmModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: cardColor }]}>
              <View style={styles.modalIconBg}>
                <IconSymbol name="exclamationmark.triangle.fill" size={30} color="#F44336" />
              </View>
              <Text style={[styles.modalTitle, { color: textColor }]}>Confirm Deletion</Text>
              <Text style={styles.modalText}>
                {deleteType === 'all' 
                  ? 'Are you sure you want to permanently clear ALL gas monitoring history? This action cannot be undone.'
                  : `Are you sure you want to delete the ${selectedIds.length} selected logs?`}
              </Text>
              
              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowConfirmModal(false)}>
                  <Text style={styles.modalCancelText}>Go Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalDeleteBtn} onPress={executeDelete}>
                  <Text style={styles.modalDeleteText}>Yes, Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {isDeleting && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingText}>Updating database...</Text>
          </View>
        )}
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 25,
    paddingTop: 20,
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    elevation: 8,
    shadowOpacity: 0.08,
    shadowRadius: 15,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    fontSize: 13,
    color: '#888',
    fontWeight: '700',
    marginTop: 2,
  },
  clearAllBtn: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 12,
    elevation: 3,
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  clearAllText: {
    color: '#F44336',
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  cancelBtn: {
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  cancelText: {
    color: '#2196F3',
    fontWeight: '900',
    fontSize: 13,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 100,
    paddingTop: 10,
  },
  logItem: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 15,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  selectedItem: {
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    borderColor: '#2196F3',
    borderWidth: 2,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  logTime: {
    fontSize: 11,
    fontWeight: '800',
    color: '#999',
    letterSpacing: 0.5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  logBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  logPpm: {
    fontSize: 26,
    fontWeight: '900',
  },
  ppmLabel: {
    fontSize: 11,
    color: '#999',
    fontWeight: '900',
    marginLeft: 2,
  },
  logStatus: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  logMac: {
    fontSize: 9,
    color: '#aaa',
    fontFamily: 'monospace',
    marginTop: 4,
    fontWeight: '700',
  },
  selectionBar: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    padding: 18,
    borderRadius: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    elevation: 15,
    shadowOpacity: 0.15,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: -5 },
  },
  selectionCount: {
    fontSize: 15,
    fontWeight: '900',
  },
  selectionBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deleteBtn: {
    backgroundColor: '#F44336',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 14,
    elevation: 5,
  },
  disabledBtn: {
    backgroundColor: '#ffcdd2',
  },
  deleteBtnText: {
    color: '#fff',
    fontWeight: '900',
    marginLeft: 6,
    fontSize: 13,
  },
  selectionCancelBtn: {
    marginLeft: 12,
    paddingVertical: 10,
    paddingHorizontal: 5,
  },
  selectionCancelText: {
    color: '#2196F3',
    fontWeight: '900',
    fontSize: 13,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 120,
    paddingHorizontal: 40,
  },
  emptyText: {
    marginTop: 15,
    color: '#ccc',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 30,
    padding: 30,
    width: '100%',
    alignItems: 'center',
    elevation: 20,
  },
  modalIconBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ffebee',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 10,
  },
  modalText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 30,
    fontWeight: '600',
  },
  modalButtons: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'center',
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 15,
    alignItems: 'center',
  },
  modalCancelText: {
    fontWeight: '800',
    color: '#999',
    fontSize: 15,
  },
  modalDeleteBtn: {
    flex: 1,
    backgroundColor: '#F44336',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    elevation: 4,
  },
  modalDeleteText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 15,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  loadingText: {
    color: '#fff',
    marginTop: 15,
    fontWeight: '900',
    fontSize: 16,
  },
});
