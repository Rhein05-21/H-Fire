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
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Selection State
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const backgroundColor = useThemeColor({}, 'background');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1c1c1e' }, 'background');
  const textColor = useThemeColor({}, 'text');
  const secondaryText = useThemeColor({ light: '#8E8E93', dark: '#8E8E93' }, 'text');
  const borderColor = useThemeColor({ light: '#e5e5ea', dark: '#3a3a3c' }, 'background');
  const accentColor = '#2196F3';

  const fetchData = async () => {
    if (!profileId) return;
    try {
      // 1. Fetch Gas Logs (Regular Activity)
      const { data: logData } = await supabase
        .from('gas_logs')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false })
        .limit(50);

      // 2. Fetch Incident Alerts (Emergencies)
      const { data: alertData } = await supabase
        .from('incidents')
        .select('*, devices(label)')
        .eq('profile_id', profileId)
        .order('start_time', { ascending: false })
        .limit(30);

      // 3. Merge and Sort by Date
      const merged = [
        ...(logData || []).map(l => ({ ...l, type: 'ACTIVITY', timestamp: l.created_at, uniqueId: `log-${l.id}` })),
        ...(alertData || []).map(a => ({ ...a, type: 'ALERT', timestamp: a.start_time, uniqueId: `alert-${a.id}` }))
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setHistory(merged);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!profileId) return;
    fetchData();

    // REAL-TIME SUBSCRIPTION
    const channel = supabase
      .channel('history-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gas_logs', filter: `profile_id=eq.${profileId}` }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents', filter: `profile_id=eq.${profileId}` }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profileId]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchData();
  }, [profileId]);

  const exitEditMode = () => {
    setIsEditMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
    Haptics.selectionAsync();
  };

  const handleSelectAll = () => {
    if (selectedIds.size === history.length) {
      setSelectedIds(new Set());
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      setSelectedIds(new Set(history.map(h => h.uniqueId)));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  const isAllSelected = history.length > 0 && selectedIds.size === history.length;

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    
    Alert.alert(
      'Delete Selected',
      `Delete ${selectedIds.size} entries? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              const logIds = Array.from(selectedIds).filter(id => id.startsWith('log-')).map(id => id.replace('log-', ''));
              const alertIds = Array.from(selectedIds).filter(id => id.startsWith('alert-')).map(id => id.replace('alert-', ''));

              if (logIds.length > 0) await supabase.from('gas_logs').delete().in('id', logIds);
              if (alertIds.length > 0) await supabase.from('incidents').delete().in('id', alertIds);
              
              await fetchData();
              exitEditMode();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e) { console.error(e); }
          }
        }
      ]
    );
  };

  const renderItem = ({ item }: { item: any }) => {
    const date = new Date(item.timestamp);
    const isAlert = item.type === 'ALERT';
    const isSelected = selectedIds.has(item.uniqueId);
    
    // Color logic
    const color = isAlert 
      ? (item.alert_type === 'FIRE' ? '#FF3B30' : '#FF9500') 
      : getStatusColor(item.status);
    
    return (
      <TouchableOpacity 
        activeOpacity={0.8}
        onLongPress={() => { setIsEditMode(true); toggleSelect(item.uniqueId); }}
        onPress={() => isEditMode ? toggleSelect(item.uniqueId) : null}
        style={[
          styles.logCard, 
          { backgroundColor: cardBg },
          isSelected && { borderColor: accentColor, borderWidth: 2, backgroundColor: accentColor + '08' }
        ]}
      >
        <View style={[styles.statusLine, { backgroundColor: color }]} />
        
        {isEditMode && (
          <View style={styles.selectionCircle}>
            <IconSymbol name={isSelected ? "checkmark.circle.fill" : "circle"} size={22} color={isSelected ? accentColor : secondaryText} />
          </View>
        )}

        <View style={styles.logContent}>
          <View style={styles.logHeader}>
            <Text style={[styles.logStatus, { color }]}>{isAlert ? `${item.alert_type} ALERT` : item.status.toUpperCase()}</Text>
            <Text style={styles.logTime}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </View>
          <Text style={[styles.logPpm, { color: textColor }]}>
            {isAlert ? item.ppm_at_trigger : item.ppm_level} <Text style={styles.ppmUnit}>PPM</Text>
          </Text>
          <View style={styles.deviceRow}>
            <IconSymbol name={isAlert ? "exclamationmark.shield.fill" : "cpu"} size={10} color={secondaryText} />
            <Text style={styles.logDevice}> {isAlert ? (item.devices?.label || 'Alert Event') : item.device_mac}</Text>
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
          <Text style={styles.brandText}>H-FIRE HISTORY</Text>
          <Text style={[styles.title, { color: textColor }]}>All Events</Text>
        </View>
        
        {history.length > 0 && (
          <View style={styles.headerActions}>
            {isEditMode ? (
              <TouchableOpacity onPress={exitEditMode} style={styles.doneBtn}>
                <Text style={[styles.doneBtnText, { color: accentColor }]}>Done</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => setIsEditMode(true)} style={styles.selectBtn}>
                <Text style={[styles.actionText, { color: accentColor }]}>Select</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* TOP ACTION BAR — visible in edit mode */}
      {isEditMode && history.length > 0 && (
        <View style={[styles.topActionBar, { backgroundColor: cardBg, borderBottomColor: secondaryText + '20' }]}>
          <TouchableOpacity onPress={handleSelectAll} style={styles.topAction}>
            <IconSymbol name={isAllSelected ? "checkmark.circle.fill" : "circle.grid.3x3.fill"} size={16} color={accentColor} />
            <Text style={[styles.topActionText, { color: accentColor }]}>{isAllSelected ? 'Deselect All' : 'Select All'}</Text>
          </TouchableOpacity>
          <View style={styles.topActionDivider} />
          <TouchableOpacity onPress={handleDeleteSelected} style={[styles.topAction, selectedIds.size === 0 && { opacity: 0.3 }]} disabled={selectedIds.size === 0}>
            <IconSymbol name="minus.circle.fill" size={16} color="#FF3B30" />
            <Text style={[styles.topActionText, { color: '#FF3B30' }]}>Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={accentColor} /></View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => item.uniqueId}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, isEditMode && { paddingBottom: 160 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <IconSymbol name="doc.text.magnifyingglass" size={50} color={borderColor} />
              <Text style={[styles.emptyText, { color: secondaryText }]}>No history recorded yet.</Text>
            </View>
          }
        />
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
  tabContainer: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 10 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabText: { fontSize: 15, fontWeight: '800' },
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