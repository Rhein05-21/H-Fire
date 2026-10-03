import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  FlatList, 
  ActivityIndicator, 
  TouchableOpacity, 
  RefreshControl, 
  Platform,
  Modal,
  useColorScheme
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '@/utils/supabase';
import { useUser } from '@/context/UserContext';
import { useThemeColor } from '@/hooks/use-theme-color';
import { getStatusColor } from '@/constants/thresholds';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function HistoryScreen() {
  const { profileId, devices } = useUser();
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  const colorScheme = useColorScheme();

  // Date filter state: null = All, Date = specific day
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [tempDate, setTempDate] = useState<Date>(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [filterMode, setFilterMode] = useState<'today' | 'yesterday' | 'all' | 'custom'>('today');

  const backgroundColor = useThemeColor({}, 'background');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1c1c1e' }, 'background');
  const textColor = useThemeColor({}, 'text');
  const secondaryText = useThemeColor({ light: '#8E8E93', dark: '#8E8E93' }, 'text');
  const borderColor = useThemeColor({ light: '#e5e5ea', dark: '#3a3a3c' }, 'background');
  const accentColor = '#2196F3';

  // Ensure user can pick current day up to end-of-day boundary
  const endOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const userMacs = Object.keys(devices);
    
    try {
      let logQuery = supabase.from('gas_logs').select('*');
      let alertQuery = supabase.from('incidents').select('*, devices(label)');

      if (profileId && userMacs.length > 0) {
        logQuery = logQuery.or(`profile_id.eq.${profileId},device_mac.in.(${userMacs.map(m => `"${m}"`).join(',')})`);
        alertQuery = alertQuery.or(`profile_id.eq.${profileId},device_mac.in.(${userMacs.map(m => `"${m}"`).join(',')})`);
      } else if (profileId) {
        logQuery = logQuery.eq('profile_id', profileId);
        alertQuery = alertQuery.eq('profile_id', profileId);
      } else if (userMacs.length > 0) {
        logQuery = logQuery.in('device_mac', userMacs);
        alertQuery = alertQuery.in('device_mac', userMacs);
      }

      logQuery = logQuery.order('created_at', { ascending: false });
      alertQuery = alertQuery.order('start_time', { ascending: false });

      if (selectedDate) {
        const startOfDay = new Date(selectedDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(23, 59, 59, 999);

        logQuery = logQuery.gte('created_at', startOfDay.toISOString()).lte('created_at', endOfDay.toISOString());
        alertQuery = alertQuery.gte('start_time', startOfDay.toISOString()).lte('start_time', endOfDay.toISOString());
      } else {
        // Limit query when showing all logs to avoid excessive payload
        logQuery = logQuery.limit(100);
        alertQuery = alertQuery.limit(50);
      }

      const [{ data: logData }, { data: alertData }] = await Promise.all([logQuery, alertQuery]);

      const combined: any[] = [];

      (alertData || []).forEach(a => {
        combined.push({
          ...a,
          type: 'ALERT',
          timestamp: a.start_time || a.created_at,
          uniqueId: `alert-${a.id}-${a.start_time || ''}`
        });
      });

      (logData || []).forEach(l => {
        combined.push({
          ...l,
          type: 'ACTIVITY',
          timestamp: l.created_at,
          uniqueId: `log-${l.id}-${l.created_at || ''}`
        });
      });

      // Sort chronological descending (newest first)
      const sorted = combined.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      setHistory(sorted);
    } catch (e) {
      console.error('History fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profileId, devices, selectedDate]);

  useEffect(() => {
    fetchData();

    // Realtime listener for incoming events with safe channel naming & filtering
    const channelName = `history-realtime-${profileId || 'all'}`;
    const channel = supabase.channel(channelName);

    if (profileId) {
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'gas_logs', filter: `profile_id=eq.${profileId}` }, () => fetchData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents', filter: `profile_id=eq.${profileId}` }, () => fetchData());
    } else {
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'gas_logs' }, () => fetchData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, () => fetchData());
    }

    channel.subscribe();

    return () => { 
      supabase.removeChannel(channel); 
    };
  }, [profileId, fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchData();
  }, [fetchData]);

  // Open datepicker modal/dialog with clean temp state
  const openDatePicker = () => {
    setTempDate(selectedDate || new Date());
    setShowPicker(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Android Native Date Dialog Handler
  const onAndroidDateChange = (event: any, date?: Date) => {
    setShowPicker(false);
    if (event.type === 'set' && date) {
      const fixedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      setSelectedDate(fixedDate);
      setFilterMode('custom');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  // iOS Modal Done Button Handler
  const onConfirmIosDate = () => {
    const fixedDate = new Date(tempDate.getFullYear(), tempDate.getMonth(), tempDate.getDate());
    setSelectedDate(fixedDate);
    setFilterMode('custom');
    setShowPicker(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleSelectFilter = (mode: 'today' | 'yesterday' | 'all') => {
    Haptics.selectionAsync();
    setFilterMode(mode);

    if (mode === 'today') {
      const today = new Date();
      setSelectedDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    } else if (mode === 'yesterday') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      setSelectedDate(new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()));
    } else if (mode === 'all') {
      setSelectedDate(null);
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const date = new Date(item.timestamp);
    const isAlert = item.type === 'ALERT';
    const color = isAlert ? (item.alert_type === 'FIRE' ? '#FF3B30' : '#FF9500') : getStatusColor(item.status);
    
    return (
      <View style={[styles.logCard, { backgroundColor: cardBg }]}>
        <View style={[styles.statusLine, { backgroundColor: color }]} />
        <View style={styles.logContent}>
          <View style={styles.logHeader}>
            <Text style={[styles.logStatus, { color }]}>
              {isAlert ? `${item.alert_type} ALERT` : String(item.status || 'NORMAL').toUpperCase()}
            </Text>
            <Text style={styles.logTime}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </View>
          <Text style={[styles.logPpm, { color: textColor }]}>
            {isAlert ? item.ppm_at_trigger : (item.ppm_level || item.ppm || 0)} <Text style={styles.ppmUnit}>PPM</Text>
          </Text>
          
          {item.notes ? (
            <Text style={[styles.logNotes, { color: isAlert ? '#FF9500' : secondaryText }]}>
              {item.notes}
            </Text>
          ) : null}

          <View style={styles.deviceRow}>
            <IconSymbol name={isAlert ? "exclamationmark.shield.fill" : "cpu"} size={10} color={secondaryText} />
            <Text style={styles.logDevice}> {isAlert ? (item.devices?.label || item.device_mac || 'Sensor Unit') : (item.device_mac || 'Sensor Unit')}</Text>
            <Text style={styles.logDate}> • {date.toLocaleDateString()}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
      <StatusBar style="auto" />
      
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brandText}>H-FIRE HISTORY</Text>
            <Text style={[styles.title, { color: textColor }]}>Incident Logs</Text>
          </View>
          <TouchableOpacity 
            style={[
              styles.calendarBtn, 
              filterMode === 'custom' && { backgroundColor: accentColor + '25', borderColor: accentColor, borderWidth: 1 }
            ]} 
            onPress={openDatePicker}
          >
            <IconSymbol name="calendar" size={22} color={accentColor} />
            {filterMode === 'custom' && <View style={styles.filterDot} />}
          </TouchableOpacity>
        </View>

        {/* Quick Filter Chips */}
        <View style={styles.chipsRow}>
          <TouchableOpacity 
            style={[styles.chip, filterMode === 'today' && styles.chipActive]} 
            onPress={() => handleSelectFilter('today')}
          >
            <Text style={[styles.chipText, filterMode === 'today' && styles.chipTextActive]}>Today</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.chip, filterMode === 'yesterday' && styles.chipActive]} 
            onPress={() => handleSelectFilter('yesterday')}
          >
            <Text style={[styles.chipText, filterMode === 'yesterday' && styles.chipTextActive]}>Yesterday</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.chip, filterMode === 'all' && styles.chipActive]} 
            onPress={() => handleSelectFilter('all')}
          >
            <Text style={[styles.chipText, filterMode === 'all' && styles.chipTextActive]}>All Logs</Text>
          </TouchableOpacity>

          {filterMode === 'custom' && selectedDate && (
            <View style={[styles.chip, styles.chipActiveCustom, styles.customChipContainer]}>
              <TouchableOpacity 
                activeOpacity={0.7} 
                onPress={openDatePicker}
                style={styles.customChipTouch}
              >
                <Text style={styles.chipTextActive}>
                  📅 {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => handleSelectFilter('all')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.customChipClear}
              >
                <IconSymbol name="xmark.circle.fill" size={14} color="#ffffff" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text style={{ color: secondaryText, fontSize: 12, marginTop: 10, fontWeight: '700' }}>
          {selectedDate 
            ? `Showing: ${selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
            : 'Showing: All Recorded Incident & Gas Logs'
          }
        </Text>
      </View>

      {/* Android Native Date Picker Dialog */}
      {showPicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={selectedDate || new Date()}
          mode="date"
          display="default"
          onChange={onAndroidDateChange}
          maximumDate={endOfToday}
        />
      )}

      {/* iOS Modal with Done/Cancel Toolbar & Inline Picker */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPicker(false)}
        >
          <View style={styles.iosModalOverlay}>
            <TouchableOpacity 
              style={StyleSheet.absoluteFill} 
              activeOpacity={1} 
              onPress={() => setShowPicker(false)} 
            />
            <View style={[styles.iosModalCard, { backgroundColor: cardBg }]}>
              <View style={styles.iosModalHeader}>
                <TouchableOpacity 
                  onPress={() => setShowPicker(false)} 
                  style={styles.iosHeaderBtn}
                >
                  <Text style={[styles.iosCancelText, { color: secondaryText }]}>Cancel</Text>
                </TouchableOpacity>
                <Text style={[styles.iosModalTitle, { color: textColor }]}>Select Date</Text>
                <TouchableOpacity 
                  onPress={onConfirmIosDate} 
                  style={[styles.iosHeaderBtn, styles.iosDoneBtn]}
                >
                  <Text style={styles.iosDoneText}>Done</Text>
                </TouchableOpacity>
              </View>

              <DateTimePicker
                value={tempDate}
                mode="date"
                display="inline"
                onChange={(_, date) => {
                  if (date) setTempDate(date);
                }}
                maximumDate={endOfToday}
                themeVariant={colorScheme === 'dark' ? 'dark' : 'light'}
                style={styles.iosPicker}
              />

              <View style={styles.iosFooterRow}>
                <TouchableOpacity
                  style={[styles.iosFooterBtn, { borderColor }]}
                  onPress={() => {
                    const today = new Date();
                    setTempDate(today);
                    setSelectedDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
                    setFilterMode('today');
                    setShowPicker(false);
                    Haptics.selectionAsync();
                  }}
                >
                  <Text style={[styles.iosFooterBtnText, { color: accentColor }]}>Reset to Today</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {loading && history.length === 0 ? (
        <View style={styles.center}><ActivityIndicator size="large" color={accentColor} /></View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => item.uniqueId}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <IconSymbol name="doc.text.magnifyingglass" size={50} color={borderColor} />
              <Text style={[styles.emptyText, { color: secondaryText }]}>
                {selectedDate 
                  ? `No logs or incidents found for ${selectedDate.toLocaleDateString()}.`
                  : 'No logs recorded yet.'
                }
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 16, marginBottom: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandText: { color: '#2196F3', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  title: { fontSize: 32, fontWeight: '900', marginTop: 2 },
  
  calendarBtn: { padding: 10, backgroundColor: 'rgba(33, 150, 243, 0.1)', borderRadius: 14, position: 'relative' },
  filterDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30', borderWidth: 2, borderColor: '#fff' },

  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: 'rgba(150,150,150,0.12)' },
  chipActive: { backgroundColor: '#2196F3' },
  chipActiveCustom: { backgroundColor: '#FF9500' },
  chipText: { fontSize: 12, fontWeight: '800', color: '#8E8E93' },
  chipTextActive: { fontSize: 12, fontWeight: '900', color: '#ffffff' },
  customChipContainer: { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  customChipTouch: { paddingVertical: 1 },
  customChipClear: { marginLeft: 6, padding: 2 },

  iosModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  iosModalCard: { width: '100%', maxWidth: 360, borderRadius: 24, padding: 18, overflow: 'hidden', ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16 } }) },
  iosModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(150,150,150,0.15)' },
  iosModalTitle: { fontSize: 17, fontWeight: '800' },
  iosHeaderBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  iosCancelText: { fontSize: 15, fontWeight: '600' },
  iosDoneBtn: { backgroundColor: '#2196F3', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 },
  iosDoneText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  iosPicker: { height: 320, width: '100%' },
  iosFooterRow: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(150,150,150,0.15)', alignItems: 'center' },
  iosFooterBtn: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1 },
  iosFooterBtnText: { fontSize: 13, fontWeight: '700' },

  list: { padding: 20, paddingBottom: 100 },
  logCard: { borderRadius: 24, marginBottom: 14, flexDirection: 'row', overflow: 'hidden', ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10 }, android: { elevation: 3 } }) },
  statusLine: { width: 6 },
  logContent: { flex: 1, padding: 18 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  logStatus: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  logTime: { fontSize: 12, color: '#8E8E93', fontWeight: '700' },
  logPpm: { fontSize: 28, fontWeight: '900' },
  ppmUnit: { fontSize: 14, fontWeight: '700', color: '#8E8E93' },
  logNotes: { fontSize: 11, fontWeight: '700', marginTop: 4, marginBottom: 2 },
  deviceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  logDevice: { fontSize: 11, color: '#8E8E93', fontWeight: '700' },
  logDate: { fontSize: 11, color: '#8E8E93', fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 80 },
  emptyText: { marginTop: 15, fontWeight: '700', fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },
});