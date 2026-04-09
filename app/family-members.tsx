import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/utils/supabase';
import { useUser } from '@/context/UserContext';
import { useThemeColor } from '@/hooks/use-theme-color';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface FamilyMember {
  id: number;
  full_name: string;
  age: number;
  relationship: string;
  phone: string;
  email: string;
  is_primary: boolean;
}

export default function FamilyMembersScreen() {
  const router = useRouter();
  const { profileId } = useUser();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [editingMember, setEditingMember] = useState<FamilyMember | null>(null);
  
  // Form State
  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');
  const [relationship, setRelationship] = useState('Member');
  const [phone, setPhone] = useState('+639');
  const [email, setEmail] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [saving, setSaving] = useState(false);

  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1c1c1e' }, 'background');
  const secondaryText = useThemeColor({ light: '#8E8E93', dark: '#8E8E93' }, 'text');
  const inputBg = useThemeColor({ light: '#f2f2f7', dark: '#2c2c2e' }, 'background');

  const fetchMembers = async () => {
    if (!profileId) return;
    try {
      const { data, error } = await supabase
        .from('family_members')
        .select('*')
        .eq('profile_id', profileId)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true });

      if (data) setMembers(data);
      if (error) console.error('Fetch members error:', error.message);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [profileId]);

  const openModal = (member: FamilyMember | null = null) => {
    setEditingMember(member);
    if (member) {
      setFullName(member.full_name);
      setAge(member.age.toString());
      setRelationship(member.relationship);
      setPhone(member.phone);
      setEmail(member.email || '');
      setIsPrimary(member.is_primary);
    } else {
      setFullName('');
      setAge('');
      setRelationship('Member');
      setPhone('+639');
      setEmail('');
      setIsPrimary(members.length === 0); // Default first member to primary
    }
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!fullName || !phone || !age) {
      Alert.alert('Error', 'Please fill in required fields (Name, Age, Phone)');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        profile_id: profileId,
        full_name: fullName,
        age: parseInt(age),
        relationship,
        phone,
        email,
        is_primary: isPrimary,
      };

      if (isPrimary) {
        // If this one is primary, set all others to false first
        await supabase
          .from('family_members')
          .update({ is_primary: false })
          .eq('profile_id', profileId);
      }

      let error;
      if (editingMember) {
        const { error: err } = await supabase
          .from('family_members')
          .update(payload)
          .eq('id', editingMember.id);
        error = err;
      } else {
        const { error: err } = await supabase
          .from('family_members')
          .insert([payload]);
        error = err;
      }

      if (error) throw error;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalVisible(false);
      fetchMembers();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save member');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: number) => {
    Alert.alert('Delete Member', 'Are you sure you want to remove this family member?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('family_members').delete().eq('id', id);
            if (error) throw error;
            fetchMembers();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (e) {
            Alert.alert('Error', 'Failed to delete member');
          }
        },
      },
    ]);
  };

  const renderMember = ({ item }: { item: FamilyMember }) => (
    <View style={[styles.memberCard, { backgroundColor: cardBg }]}>
      <View style={styles.memberInfo}>
        <View style={styles.nameRow}>
          <Text style={[styles.memberName, { color: textColor }]}>{item.full_name}</Text>
          {item.is_primary && (
            <View style={styles.primaryBadge}>
              <Text style={styles.primaryText}>PRIMARY</Text>
            </View>
          )}
        </View>
        <Text style={[styles.memberSub, { color: secondaryText }]}>
          {item.relationship} • {item.age} years old
        </Text>
        <Text style={[styles.memberContact, { color: secondaryText }]}>
          📱 {item.phone}
        </Text>
        {item.email ? (
          <Text style={[styles.memberContact, { color: secondaryText }]}>
            📧 {item.email}
          </Text>
        ) : null}
      </View>
      <View style={styles.memberActions}>
        <TouchableOpacity onPress={() => openModal(item)} style={styles.actionBtn}>
          <IconSymbol name="pencil.circle.fill" size={24} color="#2196F3" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.actionBtn}>
          <IconSymbol name="trash.fill" size={20} color="#FF3B30" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={24} color={textColor} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: textColor }]}>Household Members</Text>
      </View>

      <View style={styles.introBox}>
        <Text style={[styles.introText, { color: secondaryText }]}>
          Register your family members. In case of emergency, the system will attempt to call these contacts.
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2196F3" />
        </View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderMember}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <IconSymbol name="person.2.fill" size={60} color={secondaryText + '40'} />
              <Text style={[styles.emptyText, { color: secondaryText }]}>No members registered yet.</Text>
              <TouchableOpacity style={styles.addInitialBtn} onPress={() => openModal()}>
                <Text style={styles.addInitialText}>Add First Member</Text>
              </TouchableOpacity>
            </View>
          }
          ListFooterComponent={
            members.length > 0 ? (
              <TouchableOpacity style={styles.addFab} onPress={() => openModal()}>
                <IconSymbol name="plus" size={24} color="#fff" />
                <Text style={styles.addFabText}>Add Member</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {/* MEMBER MODAL */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: cardBg }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: textColor }]}>
                {editingMember ? 'Edit Member' : 'Add Member'}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <IconSymbol name="xmark.circle.fill" size={24} color={secondaryText} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.form}>
              <Text style={styles.label}>FULL NAME *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: inputBg, color: textColor }]}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Juan Dela Cruz"
                placeholderTextColor="#999"
              />

              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 10 }}>
                  <Text style={styles.label}>AGE *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: inputBg, color: textColor }]}
                    value={age}
                    onChangeText={(t) => setAge(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    placeholder="45"
                    placeholderTextColor="#999"
                  />
                </View>
                <View style={{ flex: 2 }}>
                  <Text style={styles.label}>RELATIONSHIP</Text>
                  <View style={styles.relationshipRow}>
                    {['Head', 'Spouse', 'Child', 'Other'].map((r) => (
                      <TouchableOpacity
                        key={r}
                        style={[
                          styles.relChip,
                          { backgroundColor: relationship === r ? '#2196F3' : inputBg },
                        ]}
                        onPress={() => setRelationship(r)}
                      >
                        <Text
                          style={[
                            styles.relChipText,
                            { color: relationship === r ? '#fff' : textColor, fontSize: 10 },
                          ]}
                        >
                          {r.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              <Text style={styles.label}>PHONE NUMBER (E.164) *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: inputBg, color: textColor }]}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="+639..."
                placeholderTextColor="#999"
              />

              <Text style={styles.label}>EMAIL (OPTIONAL)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: inputBg, color: textColor }]}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="juan@gmail.com"
                placeholderTextColor="#999"
              />

              <TouchableOpacity
                style={styles.checkRow}
                onPress={() => setIsPrimary(!isPrimary)}
              >
                <IconSymbol
                  name={isPrimary ? 'checkmark.square.fill' : 'square'}
                  size={20}
                  color={isPrimary ? '#2196F3' : secondaryText}
                />
                <Text style={[styles.checkLabel, { color: textColor }]}>Set as Primary Contact</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.7 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Member</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 15 },
  backBtn: { padding: 5, marginRight: 10 },
  title: { fontSize: 24, fontWeight: '900' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  introBox: { paddingHorizontal: 25, marginBottom: 20 },
  introText: { fontSize: 13, lineHeight: 20 },
  list: { padding: 20, paddingBottom: 100 },
  memberCard: { borderRadius: 20, padding: 20, marginBottom: 15, flexDirection: 'row', alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8 },
  memberInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  memberName: { fontSize: 18, fontWeight: '800' },
  primaryBadge: { backgroundColor: '#34C75920', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  primaryText: { color: '#34C759', fontSize: 9, fontWeight: '900' },
  memberSub: { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  memberContact: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  memberActions: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  actionBtn: { padding: 5 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 80 },
  emptyText: { marginTop: 15, fontWeight: '700' },
  addInitialBtn: { marginTop: 20, backgroundColor: '#2196F3', paddingHorizontal: 25, paddingVertical: 12, borderRadius: 12 },
  addInitialText: { color: '#fff', fontWeight: '900' },
  addFab: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#2196F3', padding: 18, borderRadius: 15, marginTop: 10, gap: 10 },
  addFabText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 30, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  modalTitle: { fontSize: 22, fontWeight: '900' },
  form: { gap: 15 },
  label: { fontSize: 10, fontWeight: '900', color: '#8E8E93', marginBottom: 8, letterSpacing: 1 },
  input: { borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 15, fontWeight: '600' },
  row: { flexDirection: 'row' },
  relationshipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  relChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  relChipText: { fontWeight: '800' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 10 },
  checkLabel: { fontWeight: '700', fontSize: 14 },
  saveBtn: { backgroundColor: '#2196F3', padding: 20, borderRadius: 15, alignItems: 'center', marginTop: 20 },
  saveBtnText: { color: '#fff', fontWeight: '900', fontSize: 16 },
});
