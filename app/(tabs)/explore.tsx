import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/utils/supabase';
import { useUser } from '@/context/UserContext';
import { useThemeColor } from '@/hooks/use-theme-color';
import { getStatusColor } from '@/constants/thresholds';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function HistoryScreen() {
  const { profileId } = useUser();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Selection State
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const backgroundColor = useThemeColor({}, 'background');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1c1c1e' }, 'background');
  const textColor = useThemeColor({}, 'text');
  const secondaryText = useThemeColor({ light: '#8E8E93', dark: '#8E8E93' }, 'text');
  const accentColor = '#2196F3';

  const fetchHistory = async () => {
    if (!profileId) return;
    try {
      const { data, error } = await supabase
        .from('gas_logs')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (data) setLogs(data);
      if (error) console.error('History Fetch Error:', error.message);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [profileId]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchHistory();
  }, [profileId]);

  const exitEditMode = () => {
    setIsEditMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
    Haptics.selectionAsync();
  };

  const handleSelectAll = () => {
    if (selectedIds.size === logs.length) {
      // Deselect all
      setSelectedIds(new Set());
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      // Select all
      setSelectedIds(new Set(logs.map(l => l.id)));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  const isAllSelected = logs.length > 0 && selectedIds.size === logs.length;

  const handleClearAll = () => {
    Alert.alert(
      'Clear All History',
      `This will permanently delete ALL ${logs.length} recorded gas logs. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete All', 
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('gas_logs')
                .delete()
                .eq('profile_id', profileId);
              
              if (!error) {
                setLogs([]);
                exitEditMode();
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            } catch (e) { console.error(e); }
          }
        }
      ]
    );
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    
    Alert.alert(
      'Delete Selected',
      `Are you sure you want to delete ${selectedIds.size} selected ${selectedIds.size === 1 ? 'entry' : 'entries'}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: `Delete ${selectedIds.size} ${selectedIds.size === 1 ? 'Entry' : 'Entries'}`, 
          style: 'destructive',
          onPress: async () => {
            try {
              const idsArray = Array.from(selectedIds);
              const { error } = await supabase
                .from('gas_logs')
                .delete()
                .in('id', idsArray);
              
              if (!error) {
                setLogs(prev => prev.filter(log => !selectedIds.has(log.id)));
                setSelectedIds(new Set());
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            } catch (e) { console.error(e); }
          }
        }
      ]
    );
  };

  const renderLog = ({ item }: { item: any }) => {
    const date = new Date(item.created_at);
    const color = getStatusColor(item.status);
    const isSelected = selectedIds.has(item.id);
    
    return (
      <TouchableOpacity 
        activeOpacity={0.8}
        onLongPress={() => { setIsEditMode(true); toggleSelect(item.id); }}
        onPress={() => isEditMode ? toggleSelect(item.id) : null}
        style={[
          styles.logCard, 
          { backgroundColor: cardBg },
          isSelected && { borderColor: accentColor, borderWidth: 2, backgroundColor: accentColor + '08' }
        ]}
      >
        {!isEditMode && <View style={[styles.statusLine, { backgroundColor: color }]} />}
        
        {isEditMode && (
          <View style={styles.selectionCircle}>
            <IconSymbol 
              name={isSelected ? "checkmark.circle.fill" : "circle"} 
              size={22} 
              color={isSelected ? accentColor : secondaryText} 
            />
          </View>
        )}

        <View style={styles.logContent}>
          <View style={styles.logHeader}>
            <Text style={[styles.logStatus, { color }]}>{item.status.toUpperCase()}</Text>
            <Text style={styles.logTime}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </View>
          <Text style={[styles.logPpm, { color: textColor }]}>{item.ppm_level} <Text style={styles.ppmUnit}>PPM</Text></Text>
          <View style={styles.deviceRow}>
            <IconSymbol name="cpu" size={10} color={secondaryText} />
            <Text style={styles.logDevice}> {item.device_mac}</Text>
            <Text style={styles.logDate}> • {date.toLocaleDateString()}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
      <StatusBar style="auto" />
      
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brandText}>EVENT LOGS</Text>
          <Text style={[styles.title, { color: textColor }]}>History</Text>
        </View>
        
        {logs.length > 0 && (
          <View style={styles.headerActions}>
            {isEditMode ? (
              <View style={styles.editHeaderRow}>
                {selectedIds.size > 0 && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{selectedIds.size} selected</Text>
                  </View>
                )}
                <TouchableOpacity onPress={exitEditMode} style={styles.doneBtn}>
                  <Text style={[styles.doneBtnText, { color: accentColor }]}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setIsEditMode(true)} style={styles.selectBtn}>
                <Text style={[styles.actionText, { color: accentColor }]}>Select</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* TOP ACTION BAR — visible in edit mode */}
      {isEditMode && logs.length > 0 && (
        <View style={[styles.topActionBar, { backgroundColor: cardBg, borderBottomColor: secondaryText + '20' }]}>
          <TouchableOpacity onPress={handleSelectAll} style={styles.topAction}>
            <IconSymbol
              name={isAllSelected ? "checkmark.circle.fill" : "circle.grid.3x3.fill"}
              size={16}
              color={accentColor}
            />
            <Text style={[styles.topActionText, { color: accentColor }]}>
              {isAllSelected ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>

          <View style={styles.topActionDivider} />

          <TouchableOpacity
            onPress={handleDeleteSelected}
            style={[styles.topAction, selectedIds.size === 0 && { opacity: 0.3 }]}
            disabled={selectedIds.size === 0}
          >
            <IconSymbol name="minus.circle.fill" size={16} color="#FF3B30" />
            <Text style={[styles.topActionText, { color: '#FF3B30' }]}>
              Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </Text>
          </TouchableOpacity>

          <View style={styles.topActionDivider} />

          <TouchableOpacity onPress={handleClearAll} style={styles.topAction}>
            <IconSymbol name="trash.fill" size={16} color="#FF3B30" />
            <Text style={[styles.topActionText, { color: '#FF3B30' }]}>Clear All</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={accentColor} /></View>
      ) : (
        <>
          <FlatList
            data={logs}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderLog}
            contentContainerStyle={[styles.list, isEditMode && { paddingBottom: 160 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <IconSymbol name="doc.text.magnifyingglass" size={50} color={secondaryText} />
                <Text style={[styles.emptyText, { color: secondaryText }]}>No activity recorded yet.</Text>
              </View>
            }
          />

          {isEditMode && (
            <View style={[styles.bottomBar, { backgroundColor: cardBg, borderTopColor: secondaryText + '20' }]}>
              
              {/* Select All / Deselect All */}
              <TouchableOpacity onPress={handleSelectAll} style={styles.bottomAction}>
                <IconSymbol
                  name={isAllSelected ? "checkmark.circle.fill" : "circle.grid.3x3.fill"}
                  size={20}
                  color={accentColor}
                />
                <Text style={[styles.bottomActionText, { color: accentColor }]}>
                  {isAllSelected ? 'Deselect All' : 'Select All'}
                </Text>
              </TouchableOpacity>

              <View style={styles.bottomDivider} />

              {/* Delete Selected */}
              <TouchableOpacity
                onPress={handleDeleteSelected}
                style={[styles.bottomAction, selectedIds.size === 0 && { opacity: 0.3 }]}
                disabled={selectedIds.size === 0}
              >
                <IconSymbol name="minus.circle.fill" size={20} color="#FF3B30" />
                <Text style={[styles.bottomActionText, { color: '#FF3B30' }]}>
                  Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                </Text>
              </TouchableOpacity>

              <View style={styles.bottomDivider} />

              {/* Clear All */}
              <TouchableOpacity onPress={handleClearAll} style={styles.bottomAction}>
                <IconSymbol name="trash.fill" size={20} color="#FF3B30" />
                <Text style={[styles.bottomActionText, { color: '#FF3B30' }]}>Clear All</Text>
              </TouchableOpacity>

            </View>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 25, paddingTop: 20, marginBottom: 15 },
  headerActions: { paddingBottom: 5 },
  editHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countBadge: { backgroundColor: '#2196F320', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  countBadgeText: { color: '#2196F3', fontSize: 11, fontWeight: '900' },
  selectBtn: { paddingVertical: 6, paddingHorizontal: 2 },
  doneBtn: { paddingVertical: 6 },
  doneBtnText: { fontWeight: '800', fontSize: 16 },
  actionText: { fontWeight: '800', fontSize: 16 },
  brandText: { color: '#2196F3', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  title: { fontSize: 34, fontWeight: '900', marginTop: 4 },
  list: { padding: 20, paddingBottom: 120 },
  logCard: { borderRadius: 20, marginBottom: 15, flexDirection: 'row', overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8 }, android: { elevation: 2 } }) },
  statusLine: { width: 5 },
  selectionCircle: { width: 54, justifyContent: 'center', alignItems: 'center' },
  logContent: { flex: 1, padding: 18 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  logStatus: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  logTime: { fontSize: 12, color: '#8E8E93', fontWeight: '700' },
  logPpm: { fontSize: 24, fontWeight: '900' },
  ppmUnit: { fontSize: 12, fontWeight: '700', color: '#8E8E93' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  logDevice: { fontSize: 10, color: '#8E8E93', fontWeight: '700' },
  logDate: { fontSize: 10, color: '#8E8E93', fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 100 },
  emptyText: { marginTop: 15, fontWeight: '700', fontSize: 14 },

  bottomBar: { 
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 16, paddingBottom: 38, paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 }, android: { elevation: 20 } })
  },
  bottomAction: { flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 4 },
  bottomActionText: { fontWeight: '800', fontSize: 11, textAlign: 'center' },
  bottomDivider: { width: 1, height: 36, backgroundColor: 'rgba(142,142,147,0.2)' },

  topActionBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 10,
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  topAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  topActionText: { fontWeight: '800', fontSize: 12 },
  topActionDivider: { width: 1, height: 24, backgroundColor: 'rgba(142,142,147,0.25)' },
});