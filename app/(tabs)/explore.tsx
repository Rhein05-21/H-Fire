import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, Platform, Alert } from 'react-native';
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
  const { profileId } = useUser();
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Date & UI State
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showPicker, setShowPicker] = useState(false);

  const backgroundColor = useThemeColor({}, 'background');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1c1c1e' }, 'background');
  const textColor = useThemeColor({}, 'text');
  const secondaryText = useThemeColor({ light: '#8E8E93', dark: '#8E8E93' }, 'text');
  const borderColor = useThemeColor({ light: '#e5e5ea', dark: '#3a3a3c' }, 'background');
  const accentColor = '#2196F3';

  const fetchData = async () => {
    if (!profileId) return;
    setLoading(true);
    
    try {
      let logQuery = supabase.from('gas_logs').select('*').eq('profile_id', profileId).order('created_at', { ascending: false });
      let alertQuery = supabase.from('incidents').select('*, devices(label)').eq('profile_id', profileId).order('start_time', { ascending: false });

      if (selectedDate) {
        const startOfDay = new Date(selectedDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(23, 59, 59, 999);

        logQuery = logQuery.gte('created_at', startOfDay.toISOString()).lte('created_at', endOfDay.toISOString());
        alertQuery = alertQuery.gte('start_time', startOfDay.toISOString()).lte('start_time', endOfDay.toISOString());
      }

      const [{ data: logData }, { data: alertData }] = await Promise.all([logQuery, alertQuery]);

      // --- DEDUPLICATION & OVERWRITING LOGIC ---
      const latestMap = new Map();

      (alertData || []).forEach(a => {
        if (!latestMap.has(a.device_mac)) {
          latestMap.set(a.device_mac, { ...a, type: 'ALERT', timestamp: a.start_time, uniqueId: `alert-${a.id}` });
        }
      });

      (logData || []).forEach(l => {
        const existing = latestMap.get(l.device_mac);
        if (!existing || new Date(l.created_at) > new Date(existing.timestamp)) {
          latestMap.set(l.device_mac, { ...l, type: 'ACTIVITY', timestamp: l.created_at, uniqueId: `log-${l.id}` });
        }
      });

      const merged = Array.from(latestMap.values()).sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      setHistory(merged);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();

    // REAL-TIME SUBSCRIPTION
    const channel = supabase
      .channel('history-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gas_logs', filter: `profile_id=eq.${profileId}` }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents', filter: `profile_id=eq.${profileId}` }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profileId, selectedDate]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchData();
  }, [profileId, selectedDate]);

  const onDateChange = (event: any, date?: Date) => {
    setShowPicker(Platform.OS === 'ios');
    if (date) {
      setSelectedDate(date);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
            <Text style={[styles.logStatus, { color }]}>{isAlert ? `${item.alert_type} ALERT` : item.status.toUpperCase()}</Text>
            <Text style={styles.logTime}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </View>
          <Text style={[styles.logPpm, { color: textColor }]}>
            {isAlert ? item.ppm_at_trigger : (item.ppm_level || item.ppm)} <Text style={styles.ppmUnit}>PPM</Text>
          </Text>
          <View style={styles.deviceRow}>
            <IconSymbol name={isAlert ? "exclamationmark.shield.fill" : "cpu"} size={10} color={secondaryText} />
            <Text style={styles.logDevice}> {isAlert ? (item.devices?.label || 'Emergency Unit') : item.device_mac}</Text>
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
          <TouchableOpacity style={styles.calendarBtn} onPress={() => setShowPicker(true)}>
            <IconSymbol name="calendar" size={24} color={accentColor} />
            {selectedDate && <View style={styles.filterDot} />}
          </TouchableOpacity>
        </View>
        <Text style={{ color: secondaryText, fontSize: 13, marginTop: 5, fontWeight: '600' }}>
          Showing: {selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </Text>
      </View>

      {showPicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={onDateChange}
          maximumDate={new Date()}
        />
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
                No incidents found for {selectedDate.toLocaleDateString()}.
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
  header: { paddingHorizontal: 25, paddingTop: 20, marginBottom: 15 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandText: { color: '#2196F3', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  title: { fontSize: 34, fontWeight: '900', marginTop: 4 },
  
  calendarBtn: { padding: 12, backgroundColor: 'rgba(33, 150, 243, 0.1)', borderRadius: 16, position: 'relative' },
  filterDot: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30', borderWidth: 2, borderColor: '#fff' },

  list: { padding: 20, paddingBottom: 100 },
  logCard: { borderRadius: 24, marginBottom: 16, flexDirection: 'row', overflow: 'hidden', ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10 }, android: { elevation: 3 } }) },
  statusLine: { width: 6 },
  logContent: { flex: 1, padding: 20 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  logStatus: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  logTime: { fontSize: 12, color: '#8E8E93', fontWeight: '700' },
  logPpm: { fontSize: 28, fontWeight: '900' },
  ppmUnit: { fontSize: 14, fontWeight: '700', color: '#8E8E93' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  logDevice: { fontSize: 11, color: '#8E8E93', fontWeight: '700' },
  logDate: { fontSize: 11, color: '#8E8E93', fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 100 },
  emptyText: { marginTop: 15, fontWeight: '700', fontSize: 14, textAlign: 'center', paddingHorizontal: 50 },
});