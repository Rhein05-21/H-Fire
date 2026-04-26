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
  
  // Date & Pagination State
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [showCalendar, setShowCalendar] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const ITEMS_PER_PAGE = 10;

  const backgroundColor = useThemeColor({}, 'background');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1c1c1e' }, 'background');
  const textColor = useThemeColor({}, 'text');
  const secondaryText = useThemeColor({ light: '#8E8E93', dark: '#8E8E93' }, 'text');
  const borderColor = useThemeColor({ light: '#e5e5ea', dark: '#3a3a3c' }, 'background');
  const accentColor = '#2196F3';

  const fetchData = async (page = 1) => {
    if (!profileId) return;
    if (page === 1) setLoading(true);
    
    try {
      const from = (page - 1) * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;

      let logQuery = supabase.from('gas_logs').select('*').eq('profile_id', profileId).order('created_at', { ascending: false }).range(from, to);
      let alertQuery = supabase.from('incidents').select('*, devices(label)').eq('profile_id', profileId).order('start_time', { ascending: false }).range(from, to);

      if (selectedDate) {
        const startOfDay = new Date(selectedDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(23, 59, 59, 999);

        logQuery = logQuery.gte('created_at', startOfDay.toISOString()).lte('created_at', endOfDay.toISOString());
        alertQuery = alertQuery.gte('start_time', startOfDay.toISOString()).lte('start_time', endOfDay.toISOString());
      }

      const [{ data: logData }, { data: alertData }] = await Promise.all([logQuery, alertQuery]);

      // Merge and Sort
      const merged = [
        ...(logData || []).map(l => ({ ...l, type: 'ACTIVITY', timestamp: l.created_at, uniqueId: `log-${l.id}-${l.created_at}` })),
        ...(alertData || []).map(a => ({ ...a, type: 'ALERT', timestamp: a.start_time, uniqueId: `alert-${a.id}-${a.start_time}` }))
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const sliced = merged.slice(0, ITEMS_PER_PAGE);
      
      if (page === 1) setHistory(sliced);
      else setHistory(prev => [...prev, ...sliced]);

      setHasMore(merged.length >= ITEMS_PER_PAGE);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData(1);
    setCurrentPage(1);

    // REAL-TIME SUBSCRIPTION
    const channel = supabase
      .channel('history-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gas_logs', filter: `profile_id=eq.${profileId}` }, () => fetchData(1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents', filter: `profile_id=eq.${profileId}` }, () => fetchData(1))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profileId, selectedDate]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchData(1);
  }, [profileId, selectedDate]);

  const handleLoadMore = () => {
    if (hasMore && !loading) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      fetchData(nextPage);
    }
  };

  // --- CALENDAR GRID LOGIC ---
  const renderCalendar = () => {
    const calendarDate = selectedDate || new Date();
    const daysInMonth = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0).getDate();
    const days = [];
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    const monthKey = `${calendarDate.getFullYear()}-${calendarDate.getMonth()}`;

    return (
      <Modal visible={showCalendar} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.calendarCard, { backgroundColor: cardBg }]}>
            <View style={styles.calendarHeader}>
              <Text style={[styles.monthText, { color: textColor }]}>
                {calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </Text>
              <View style={{ flexDirection: 'row', gap: 15, alignItems: 'center' }}>
                <TouchableOpacity onPress={() => { setSelectedDate(null); setShowCalendar(false); }}>
                  <Text style={{ color: accentColor, fontWeight: '800', fontSize: 12 }}>VIEW ALL</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowCalendar(false)}>
                  <IconSymbol name="xmark.circle.fill" size={24} color={secondaryText} />
                </TouchableOpacity>
              </View>
            </View>
            
            <View style={styles.daysGrid}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, idx) => (
                <Text key={`label-${d}-${idx}`} style={styles.dayLabel}>{d}</Text>
              ))}
              {days.map(d => {
                const isSelected = selectedDate && d === selectedDate.getDate() && calendarDate.getMonth() === selectedDate.getMonth();
                return (
                  <TouchableOpacity 
                    key={`${monthKey}-${d}`} 
                    onPress={() => {
                      const newDate = new Date(calendarDate);
                      newDate.setDate(d);
                      setSelectedDate(newDate);
                      setShowCalendar(false);
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }}
                    style={[styles.dayCell, isSelected && { backgroundColor: accentColor }]}
                  >
                    <Text style={[styles.dayText, { color: isSelected ? '#fff' : textColor }]}>{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    );
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
            {isAlert ? item.ppm_at_trigger : item.ppm_level} <Text style={styles.ppmUnit}>PPM</Text>
          </Text>
          <View style={styles.deviceRow}>
            <IconSymbol name={isAlert ? "exclamationmark.shield.fill" : "cpu"} size={10} color={secondaryText} />
            <Text style={styles.logDevice}> {isAlert ? (item.devices?.label || 'Alert Event') : item.device_mac}</Text>
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
        <View style={{ flex: 1 }}>
          <Text style={styles.brandText}>H-FIRE HISTORY</Text>
          <View style={styles.titleContainer}>
            <Text style={[styles.title, { color: textColor }]}>All Events</Text>
            <TouchableOpacity style={styles.calendarIconButton} onPress={() => setShowCalendar(true)}>
              <IconSymbol name="calendar" size={24} color={accentColor} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {renderCalendar()}

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
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={hasMore ? <ActivityIndicator style={{ marginVertical: 20 }} color={accentColor} /> : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <IconSymbol name="doc.text.magnifyingglass" size={50} color={secondaryText + '40'} />
              <Text style={[styles.emptyText, { color: secondaryText }]}>
                No history recorded yet {selectedDate ? `for ${selectedDate.toLocaleDateString()}` : ''}.
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
  titleContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, width: '100%' },
  calendarIconButton: { padding: 10, backgroundColor: 'rgba(33, 150, 243, 0.1)', borderRadius: 14, marginRight: 5 },
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