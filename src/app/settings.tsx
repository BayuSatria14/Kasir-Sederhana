import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  View,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/utils/supabase';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function SettingsScreen() {
  const theme = useTheme();

  // Settings States
  const [shopName, setShopName] = useState('IGA BABI MELTIQ');
  const [cashiers, setCashiers] = useState<string[]>([]);
  const [newCashierName, setNewCashierName] = useState('');
  const [defaultCashier, setDefaultCashier] = useState('');

  // Load settings on tab focus
  const loadSettings = async () => {
    try {
      const { data, error } = await supabase.from('settings').select('*');
      if (error) throw error;

      if (data) {
        const shopRow = data.find(r => r.key === 'shop_name');
        if (shopRow) setShopName(shopRow.value);

        const cashiersRow = data.find(r => r.key === 'cashiers');
        if (cashiersRow) setCashiers(cashiersRow.value || []);

        const defaultRow = data.find(r => r.key === 'default_cashier');
        if (defaultRow) setDefaultCashier(defaultRow.value);
      }
    } catch (e) {
      console.error('Failed to load settings from Supabase', e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [])
  );

  // Realtime: auto-sync settings across devices
  useEffect(() => {
    const channel = supabase
      .channel('settings-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => {
        loadSettings();
      })
      .subscribe((status, err) => {
        console.log('Realtime (settings.tsx) Status:', status, err ? err : '');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Shop Name Actions
  const handleSaveShopName = async () => {
    const trimmed = shopName.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Nama toko tidak boleh kosong.');
      return;
    }
    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'shop_name', value: trimmed });
      if (error) throw error;
      Alert.alert('Sukses', 'Nama toko berhasil disimpan!');
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Gagal menyimpan nama toko.');
    }
  };

  // Cashier Actions
  const handleAddCashier = async () => {
    const trimmed = newCashierName.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Nama kasir tidak boleh kosong.');
      return;
    }
    if (cashiers.includes(trimmed)) {
      Alert.alert('Error', 'Nama kasir sudah ada.');
      return;
    }

    const updated = [...cashiers, trimmed];
    try {
      const { error: cashiersError } = await supabase
        .from('settings')
        .upsert({ key: 'cashiers', value: updated });
      if (cashiersError) throw cashiersError;

      setCashiers(updated);
      setNewCashierName('');
      
      // If this is the first cashier, set as default automatically
      if (updated.length === 1) {
        const { error: defaultError } = await supabase
          .from('settings')
          .upsert({ key: 'default_cashier', value: trimmed });
        if (defaultError) throw defaultError;
        setDefaultCashier(trimmed);
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Gagal menambahkan kasir.');
    }
  };

  const handleDeleteCashier = (name: string) => {
    const performDelete = async () => {
      const updated = cashiers.filter((c) => c !== name);
      try {
        const { error: cashiersError } = await supabase
          .from('settings')
          .upsert({ key: 'cashiers', value: updated });
        if (cashiersError) throw cashiersError;

        setCashiers(updated);

        // If default cashier is deleted, clear it or assign another
        if (defaultCashier === name) {
          const nextDefault = updated.length > 0 ? updated[0] : '';
          const { error: defaultError } = await supabase
            .from('settings')
            .upsert({ key: 'default_cashier', value: nextDefault });
          if (defaultError) throw defaultError;
          setDefaultCashier(nextDefault);
        }
      } catch (e) {
        console.error(e);
        Alert.alert('Error', 'Gagal menghapus kasir.');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Hapus kasir "${name}"?`)) {
        performDelete();
      }
    } else {
      Alert.alert(
        'Hapus Kasir',
        `Apakah Anda yakin ingin menghapus kasir "${name}"?`,
        [
          { text: 'Batal', style: 'cancel' },
          { text: 'Hapus', style: 'destructive', onPress: performDelete },
        ]
      );
    }
  };

  const handleSetDefaultCashier = async (name: string) => {
    try {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: 'default_cashier', value: name });
      if (error) throw error;
      setDefaultCashier(name);
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Gagal mengatur kasir default.');
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={styles.header}>
          <ThemedText type="subtitle" style={styles.headerTitle}>
            Pengaturan
          </ThemedText>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Card 1: Informasi Toko */}
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.cardHeader}>
              <ThemedText type="smallBold" style={styles.cardTitle}>
                🏪 Informasi Toko
              </ThemedText>
            </View>
            <View style={styles.cardBody}>
              <ThemedText type="small" style={styles.label}>
                Nama Toko di Struk
              </ThemedText>
              <View style={styles.row}>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.background,
                      color: theme.text,
                      borderColor: theme.backgroundSelected,
                      flex: 1,
                    },
                  ]}
                  value={shopName}
                  onChangeText={setShopName}
                  placeholder="Contoh: Toko Kita"
                  placeholderTextColor={theme.textSecondary}
                />
                <Pressable
                  style={styles.saveBtn}
                  onPress={handleSaveShopName}
                >
                  <ThemedText style={styles.btnText}>Simpan</ThemedText>
                </Pressable>
              </View>
            </View>
          </ThemedView>

          {/* Card 2: Pengelolaan Kasir */}
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.cardHeader}>
              <ThemedText type="smallBold" style={styles.cardTitle}>
                👥 Kelola Staff Kasir
              </ThemedText>
            </View>
            <View style={styles.cardBody}>
              <ThemedText type="small" style={styles.label}>
                Tambah Kasir Baru
              </ThemedText>
              <View style={styles.row}>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.background,
                      color: theme.text,
                      borderColor: theme.backgroundSelected,
                      flex: 1,
                    },
                  ]}
                  value={newCashierName}
                  onChangeText={setNewCashierName}
                  placeholder="Nama Kasir (contoh: Ani)"
                  placeholderTextColor={theme.textSecondary}
                />
                <Pressable
                  style={[styles.saveBtn, { backgroundColor: '#007AFF' }]}
                  onPress={handleAddCashier}
                >
                  <ThemedText style={styles.btnText}>Tambah</ThemedText>
                </Pressable>
              </View>

              <ThemedText type="smallBold" style={[styles.label, { marginTop: Spacing.three }]}>
                Daftar Kasir ({cashiers.length})
              </ThemedText>

              {cashiers.length === 0 ? (
                <View style={styles.emptyState}>
                  <ThemedText themeColor="textSecondary" style={{ fontSize: 13 }}>
                    Belum ada kasir yang didaftarkan.
                  </ThemedText>
                </View>
              ) : (
                <View style={styles.cashierList}>
                  {cashiers.map((name) => {
                    const isDefault = defaultCashier === name;
                    return (
                      <ThemedView
                        key={name}
                        type="backgroundSelected"
                        style={styles.cashierItem}
                      >
                        <View style={{ flex: 1 }}>
                          <ThemedText type="default" style={styles.cashierName}>
                            {name}
                          </ThemedText>
                          {isDefault && (
                            <View style={styles.defaultBadge}>
                              <ThemedText style={styles.defaultBadgeText}>
                                Kasir Utama
                              </ThemedText>
                            </View>
                          )}
                        </View>

                        <View style={styles.itemActions}>
                          {!isDefault && (
                            <Pressable
                              style={styles.actionBtn}
                              onPress={() => handleSetDefaultCashier(name)}
                            >
                              <ThemedText style={{ color: '#007AFF', fontSize: 13, fontWeight: '600' }}>
                                Set Utama
                              </ThemedText>
                            </Pressable>
                          )}
                          
                          <Pressable
                            style={[styles.actionBtn, styles.deleteBtn]}
                            onPress={() => handleDeleteCashier(name)}
                          >
                            <ThemedText style={{ color: '#FF3B30', fontSize: 13, fontWeight: '600' }}>
                              Hapus
                            </ThemedText>
                          </Pressable>
                        </View>
                      </ThemedView>
                    );
                  })}
                </View>
              )}
            </View>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    width: '100%',
  },
  header: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  cardHeader: {
    borderBottomWidth: 1,
    borderColor: 'rgba(142, 142, 147, 0.2)',
    paddingBottom: Spacing.two,
    marginBottom: Spacing.two,
  },
  cardTitle: {
    fontSize: 16,
  },
  cardBody: {
    gap: Spacing.one,
  },
  label: {
    fontWeight: 'bold',
    marginBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
  },
  saveBtn: {
    backgroundColor: '#34C759',
    height: 44,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  emptyState: {
    paddingVertical: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashierList: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  cashierItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.two,
    borderRadius: Spacing.two,
  },
  cashierName: {
    fontWeight: 'bold',
  },
  defaultBadge: {
    backgroundColor: 'rgba(52, 199, 89, 0.15)',
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  defaultBadgeText: {
    color: '#34C759',
    fontSize: 11,
    fontWeight: 'bold',
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  actionBtn: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  deleteBtn: {
    // Styling can be customized
  },
});
