import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  Alert,
  Platform,
  View,
  Linking,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Print from 'expo-print';
import { supabase } from '@/utils/supabase';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  Transaction,
  formatRupiah,
  formatDateTime,
  formatWhatsAppReceipt,
  generateHTMLReceipt,
  getLocalDatePart,
} from '@/utils/receipt';

export default function HistoryScreen() {
  const theme = useTheme();
  const [history, setHistory] = useState<Transaction[]>([]);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [shopName, setShopName] = useState('IGA BABI MELTIQ');

  // Date Filter States
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  const loadHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          id, date, total, cash_paid, change, customer_name, customer_phone, cashier_name, payment_method, notes, status, order_type, payment_status,
          transaction_items (
            id,
            product_id,
            name,
            quantity,
            price,
            completed
          )
        `)
        .order('date', { ascending: false });

      if (error) throw error;

      if (data) {
        const mappedHistory: Transaction[] = data.map((tx: any) => ({
          id: tx.id,
          date: tx.date,
          total: Number(tx.total),
          cashPaid: Number(tx.cash_paid),
          change: Number(tx.change),
          customerName: tx.customer_name || undefined,
          customerPhone: tx.customer_phone || undefined,
          cashierName: tx.cashier_name || undefined,
          paymentMethod: tx.payment_method || 'Tunai',
          paymentRef: tx.payment_ref || undefined,
          notes: tx.notes || undefined,
          status: tx.status || undefined,
          orderType: tx.order_type || 'Dine In',
          paymentStatus: tx.payment_status || 'paid',
          items: (tx.transaction_items || []).map((item: any) => ({
            id: item.product_id,
            name: item.name,
            price: Number(item.price),
            quantity: item.quantity,
            completed: item.completed,
            dbId: item.id,
          })),
        }));
        setHistory(mappedHistory);
      }
    } catch (e) {
      console.error('Failed to load history from Supabase', e);
    }
  };

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase.from('settings').select('*').eq('key', 'shop_name').maybeSingle();
      if (error) throw error;
      if (data) {
        setShopName(data.value || 'IGA BABI MELTIQ');
      }
    } catch (e) {
      console.error('Failed to load settings from Supabase', e);
    }
  };

  // Load history on tab focus
  useFocusEffect(
    useCallback(() => {
      loadHistory();
      loadSettings();
    }, [])
  );

  // Realtime: auto-sync history across devices
  useEffect(() => {
    const channel = supabase
      .channel('history-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        loadHistory();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => {
        loadSettings();
      })
      .subscribe((status, err) => {
        console.log('Realtime (history.tsx) Status:', status, err ? err : '');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleClearHistory = () => {
    const performClear = async () => {
      try {
        const { error } = await supabase.from('transactions').delete().neq('id', '');
        if (error) throw error;
        setHistory([]);
      } catch (e) {
        console.error('Failed to clear history from Supabase', e);
        Alert.alert('Error', 'Gagal menghapus riwayat dari database online.');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Hapus semua riwayat transaksi? Tindakan ini tidak dapat dibatalkan.')) {
        performClear();
      }
    } else {
      Alert.alert(
        'Hapus Riwayat',
        'Apakah Anda yakin ingin menghapus semua riwayat transaksi? Tindakan ini tidak dapat dibatalkan.',
        [
          { text: 'Batal', style: 'cancel' },
          { text: 'Hapus Semua', style: 'destructive', onPress: performClear },
        ]
      );
    }
  };

  const handlePrint = async (tx: Transaction) => {
    try {
      const html = generateHTMLReceipt(tx, shopName);
      await Print.printAsync({ html });
    } catch {
      Alert.alert('Error', 'Gagal mencetak struk');
    }
  };

  const handleWhatsApp = (tx: Transaction) => {
    const phone = tx.customerPhone || '';
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.slice(1);
    }

    const text = formatWhatsAppReceipt(tx, shopName);
    const url = `https://wa.me/${cleanPhone}?text=${text}`;

    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Gagal membuka WhatsApp. Pastikan aplikasi WhatsApp terinstal.');
    });
  };

  const handleOpenDetail = (tx: Transaction) => {
    setSelectedTx(tx);
    setModalVisible(true);
  };

  // Filtering logic
  const getFilteredTransactions = () => {
    let list = history;

    // 1. Filter by Date
    if (selectedDate) {
      const todayStr = getLocalDatePart();
      const yesterdayStr = getLocalDatePart(new Date(Date.now() - 86400000));
      const targetDate = selectedDate === 'today'
        ? todayStr
        : selectedDate === 'yesterday'
        ? yesterdayStr
        : selectedDate;

      list = list.filter((tx) => getLocalDatePart(tx.date) === targetDate);
    }

    // 2. Filter by Search Query (Name, ID/Struk, WA)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((tx) => {
        const matchName = tx.customerName?.toLowerCase().includes(q) || false;
        const matchId = tx.id.toLowerCase().includes(q);
        const matchPhone = tx.customerPhone?.toLowerCase().includes(q) || false;
        return matchName || matchId || matchPhone;
      });
    }

    return list;
  };

  const todayStr = getLocalDatePart();
  const yesterdayStr = getLocalDatePart(new Date(Date.now() - 86400000));
  const activeTargetDate = selectedDate === 'today'
    ? todayStr
    : selectedDate === 'yesterday'
    ? yesterdayStr
    : selectedDate;

  const txsByDate = selectedDate
    ? history.filter((tx) => getLocalDatePart(tx.date) === activeTargetDate)
    : history;

  const filteredHistory = getFilteredTransactions();

  // Calculate statistics based on date filters (all sales on that date)
  const getFilteredRevenue = () => {
    return txsByDate.reduce((sum, tx) => sum + tx.total, 0);
  };

  const getFilteredCount = () => {
    return txsByDate.length;
  };

  const getTotalRevenue = () => {
    return history.reduce((sum, tx) => sum + tx.total, 0);
  };

  const getTotalCount = () => {
    return history.length;
  };

  const getActiveDateLabel = () => {
    if (!selectedDate) return 'Semua Riwayat';
    if (selectedDate === 'today') return 'Hari Ini';
    if (selectedDate === 'yesterday') return 'Kemarin';
    const parts = selectedDate.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return selectedDate;
  };

  const renderDateFilter = () => {
    const isSemua = selectedDate === null;
    const isHariIni = selectedDate === 'today';
    const isKemarin = selectedDate === 'yesterday';
    const isKustom = selectedDate !== null && selectedDate !== 'today' && selectedDate !== 'yesterday';

    const formatChipDate = (dateStr: string) => {
      const parts = dateStr.split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
      return dateStr;
    };

    return (
      <View style={styles.filterSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          <Pressable
            style={[styles.filterChip, { backgroundColor: theme.backgroundElement }, isSemua && styles.filterChipActive]}
            onPress={() => setSelectedDate(null)}
          >
            <ThemedText
              type="smallBold"
              style={{ color: isSemua ? '#ffffff' : theme.text }}
            >
              Semua
            </ThemedText>
          </Pressable>

          <Pressable
            style={[styles.filterChip, { backgroundColor: theme.backgroundElement }, isHariIni && styles.filterChipActive]}
            onPress={() => setSelectedDate('today')}
          >
            <ThemedText
              type="smallBold"
              style={{ color: isHariIni ? '#ffffff' : theme.text }}
            >
              Hari Ini
            </ThemedText>
          </Pressable>

          <Pressable
            style={[styles.filterChip, { backgroundColor: theme.backgroundElement }, isKemarin && styles.filterChipActive]}
            onPress={() => setSelectedDate('yesterday')}
          >
            <ThemedText
              type="smallBold"
              style={{ color: isKemarin ? '#ffffff' : theme.text }}
            >
              Kemarin
            </ThemedText>
          </Pressable>

          <Pressable
            style={[styles.filterChip, { backgroundColor: theme.backgroundElement }, isKustom && styles.filterChipActive]}
            onPress={() => setCalendarVisible(true)}
          >
            <ThemedText
              type="smallBold"
              style={{ color: isKustom ? '#ffffff' : theme.text }}
            >
              {isKustom ? `Tgl: ${formatChipDate(selectedDate!)} 📅` : 'Pilih Tanggal... 📅'}
            </ThemedText>
          </Pressable>
        </ScrollView>
      </View>
    );
  };

  const renderCalendarModal = () => {
    const MONTH_NAMES = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const DAY_HEADERS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();

    const calendarDays: (number | null)[] = [];
    for (let i = 0; i < firstDayIndex; i++) {
      calendarDays.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      calendarDays.push(i);
    }

    const handlePrevMonth = () => {
      if (calendarMonth === 0) {
        setCalendarMonth(11);
        setCalendarYear(calendarYear - 1);
      } else {
        setCalendarMonth(calendarMonth - 1);
      }
    };

    const handleNextMonth = () => {
      if (calendarMonth === 11) {
        setCalendarMonth(0);
        setCalendarYear(calendarYear + 1);
      } else {
        setCalendarMonth(calendarMonth + 1);
      }
    };

    const handleSelectDay = (day: number) => {
      const formattedDate = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      setSelectedDate(formattedDate);
      setCalendarVisible(false);
    };

    return (
      <Modal
        animationType="fade"
        transparent={true}
        visible={calendarVisible}
        onRequestClose={() => setCalendarVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView type="backgroundElement" style={styles.calendarContainer}>
            <View style={styles.calendarHeader}>
              <Pressable onPress={handlePrevMonth} style={styles.monthNavBtn}>
                <ThemedText style={styles.monthNavText}>&lt;</ThemedText>
              </Pressable>
              <ThemedText type="smallBold" style={styles.calendarTitle}>
                {MONTH_NAMES[calendarMonth]} {calendarYear}
              </ThemedText>
              <Pressable onPress={handleNextMonth} style={styles.monthNavBtn}>
                <ThemedText style={styles.monthNavText}>&gt;</ThemedText>
              </Pressable>
            </View>

            <View style={styles.weekdayRow}>
              {DAY_HEADERS.map((day) => (
                <View key={day} style={styles.weekdayCell}>
                  <ThemedText type="code" themeColor="textSecondary" style={styles.weekdayText}>
                    {day}
                  </ThemedText>
                </View>
              ))}
            </View>

            <View style={styles.daysGrid}>
              {calendarDays.map((day, index) => {
                if (day === null) {
                  return <View key={`empty-${index}`} style={styles.dayCell} />;
                }

                const dayDateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const todayStr = getLocalDatePart();
                const yesterdayStr = getLocalDatePart(new Date(Date.now() - 86400000));
                const activeTargetDate = selectedDate === 'today'
                  ? todayStr
                  : selectedDate === 'yesterday'
                  ? yesterdayStr
                  : selectedDate;
                const isCurrentSelected = activeTargetDate === dayDateStr;

                return (
                  <Pressable
                    key={`day-${day}`}
                    style={[
                      styles.dayCell,
                      isCurrentSelected && styles.dayCellActive,
                    ]}
                    onPress={() => handleSelectDay(day)}
                  >
                    <ThemedText
                      type="smallBold"
                      style={[
                        styles.dayText,
                        isCurrentSelected && styles.dayTextActive,
                      ]}
                    >
                      {day}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={styles.closeCalendarBtn}
              onPress={() => setCalendarVisible(false)}
            >
              <ThemedText style={styles.closeCalendarBtnText}>Batal</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Header */}
        <ThemedView style={styles.header}>
          <View style={{ flex: 1 }}>
            <ThemedText type="subtitle" style={styles.headerTitle}>
              Riwayat Transaksi
            </ThemedText>
            <ThemedText type="code" themeColor="textSecondary" style={{ marginTop: 2 }}>
              Filter Aktif: {getActiveDateLabel()}
            </ThemedText>
          </View>
        </ThemedView>
        
        {history.length > 0 && (
          <View style={styles.actionHeaderRow}>
            <Pressable style={styles.clearBtn} onPress={handleClearHistory}>
              <ThemedText style={styles.clearBtnText}>Hapus Semua</ThemedText>
            </Pressable>
          </View>
        )}

        {/* Date Filter selector */}
        {renderDateFilter()}

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <TextInput
            style={[styles.searchInput, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: 'rgba(142, 142, 147, 0.2)' }]}
            placeholder="🔍 Cari nama, no. struk, atau no. WA..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery ? (
            <Pressable style={styles.clearSearchBtn} onPress={() => setSearchQuery('')}>
              <ThemedText style={{ color: theme.textSecondary, fontSize: 18, fontWeight: 'bold', lineHeight: 20 }}>×</ThemedText>
            </Pressable>
          ) : null}
        </View>

        {/* Dashboard Statistics */}
        <View style={styles.dashboard}>
          <ThemedView type="backgroundElement" style={styles.statCard}>
            <ThemedText type="small" themeColor="textSecondary">
              {selectedDate ? `penjualan ${getActiveDateLabel()}` : 'penjualan'}
            </ThemedText>
            <ThemedText type="smallBold" style={[styles.statValue, { color: '#34C759' }]}>
              {formatRupiah(getFilteredRevenue())}
            </ThemedText>
            <ThemedText type="code" style={styles.statSubText} themeColor="textSecondary">
              {getFilteredCount()} Transaksi
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.statCard}>
            <ThemedText type="small" themeColor="textSecondary">
              Total Penjualan (Semua)
            </ThemedText>
            <ThemedText type="smallBold" style={[styles.statValue, { color: '#007AFF' }]}>
              {formatRupiah(getTotalRevenue())}
            </ThemedText>
            <ThemedText type="code" style={styles.statSubText} themeColor="textSecondary">
              {getTotalCount()} Transaksi
            </ThemedText>
          </ThemedView>
        </View>

        {/* Transaction History List */}
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {filteredHistory.length === 0 ? (
            <ThemedView style={styles.emptyContainer}>
              <ThemedText themeColor="textSecondary">
                {history.length === 0
                  ? 'Belum ada transaksi tercatat.'
                  : searchQuery.trim()
                  ? 'Tidak ada transaksi yang cocok dengan pencarian.'
                  : 'Tidak ada transaksi untuk filter tanggal terpilih.'}
              </ThemedText>
            </ThemedView>
          ) : (
            filteredHistory.map((tx) => (
              <Pressable
                key={tx.id}
                style={({ pressed }) => [
                  styles.historyPressable,
                  pressed && styles.pressedCard,
                ]}
                onPress={() => handleOpenDetail(tx)}
              >
                <ThemedView type="backgroundElement" style={styles.historyCard}>
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <ThemedText type="smallBold" style={styles.txId}>
                          {tx.id}
                        </ThemedText>
                        <View
                          style={[
                            styles.statusBadge,
                            {
                              backgroundColor: (tx.status || 'completed') === 'completed'
                                ? 'rgba(52, 199, 89, 0.12)'
                                : 'rgba(255, 149, 0, 0.12)'
                            }
                          ]}
                        >
                          <ThemedText
                            style={{
                              fontSize: 10,
                              fontWeight: '700',
                              color: (tx.status || 'completed') === 'completed' ? '#34C759' : '#FF9500'
                            }}
                          >
                            {(tx.status || 'completed') === 'completed' ? 'Selesai' : 'Aktif'}
                          </ThemedText>
                        </View>
                      </View>
                      <ThemedText type="code" style={styles.txDate} themeColor="textSecondary">
                        {formatDateTime(tx.date)}
                      </ThemedText>
                    </View>
                    <ThemedText type="smallBold" style={styles.txTotal}>
                      {formatRupiah(tx.total)}
                    </ThemedText>
                  </View>

                  <View style={styles.cardBody}>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {tx.items.map((it) => `${it.name} (${it.quantity})`).join(', ')}
                    </ThemedText>
                    {tx.customerName && (
                      <ThemedText type="small" style={styles.customerName}>
                        Pelanggan: {tx.customerName}
                      </ThemedText>
                    )}
                    <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                      <ThemedText type="small" style={{ fontSize: 13, fontWeight: '500' }} themeColor="textSecondary">
                        Bayar: {tx.paymentMethod || 'Tunai'}
                      </ThemedText>
                      {tx.cashierName && (
                        <ThemedText type="small" style={{ fontSize: 13, fontWeight: '500' }} themeColor="textSecondary">
                          Kasir: {tx.cashierName}
                        </ThemedText>
                      )}
                    </View>
                    {tx.notes && (
                      <ThemedText type="small" style={{ fontSize: 13, fontStyle: 'italic', marginTop: 2 }} themeColor="textSecondary">
                        Catatan: {tx.notes}
                      </ThemedText>
                    )}
                  </View>

                  {/* Actions in row */}
                  <View style={styles.cardActions}>
                    <Pressable
                      style={[styles.actionBtn, styles.printBtn]}
                      onPress={() => handlePrint(tx)}
                    >
                      <ThemedText style={styles.actionBtnText}>🖨️ Cetak</ThemedText>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.actionBtn,
                        styles.waBtn,
                        !tx.customerPhone && styles.disabledBtn,
                      ]}
                      onPress={() => handleWhatsApp(tx)}
                      disabled={!tx.customerPhone}
                    >
                      <ThemedText style={styles.actionBtnText}>💬 WA</ThemedText>
                    </Pressable>
                  </View>
                </ThemedView>
              </Pressable>
            ))
          )}
        </ScrollView>

        {/* Transaction Detail Modal */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={modalVisible}
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <ThemedView type="backgroundElement" style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <ThemedText type="smallBold" style={styles.modalTitle}>
                  Detail Transaksi
                </ThemedText>
                <Pressable
                  style={styles.closeBtn}
                  onPress={() => setModalVisible(false)}
                >
                  <ThemedText style={{ fontSize: 20 }}>×</ThemedText>
                </Pressable>
              </View>

              {selectedTx && (
                <ScrollView style={styles.modalBody}>
                  <ThemedText type="code" style={styles.detailMeta}>
                    No. Struk: {selectedTx.id}
                  </ThemedText>
                  <ThemedText type="code" style={styles.detailMeta}>
                    Tanggal: {formatDateTime(selectedTx.date)}
                  </ThemedText>

                  {selectedTx.customerName && (
                    <ThemedText type="small" style={styles.detailMetaLabel}>
                      Pelanggan: *{selectedTx.customerName}*
                    </ThemedText>
                  )}
                  {selectedTx.customerPhone && (
                    <ThemedText type="small" style={styles.detailMetaLabel}>
                      No. WhatsApp: {selectedTx.customerPhone}
                    </ThemedText>
                  )}
                  {selectedTx.cashierName && (
                    <ThemedText type="small" style={styles.detailMetaLabel}>
                      Kasir: {selectedTx.cashierName}
                    </ThemedText>
                  )}
                  <ThemedText type="small" style={styles.detailMetaLabel}>
                    Metode Bayar: {selectedTx.paymentMethod || 'Tunai'}
                  </ThemedText>
                  {selectedTx.notes && (
                    <ThemedText type="small" style={[styles.detailMetaLabel, { fontStyle: 'italic' }]}>
                      Catatan: {selectedTx.notes}
                    </ThemedText>
                  )}

                  <View style={styles.divider} />

                  {/* Items List */}
                  {selectedTx.items.map((item) => (
                    <View key={item.dbId || item.id} style={styles.itemRow}>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="smallBold">
                          {item.name}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {item.quantity}x {formatRupiah(item.price)}
                        </ThemedText>
                      </View>
                      
                      <ThemedText type="smallBold">
                        {formatRupiah(item.price * item.quantity)}
                      </ThemedText>
                    </View>
                  ))}

                  <View style={styles.divider} />

                  {/* Summary Rows */}
                  <View style={styles.summaryRow}>
                    <ThemedText type="small">Total Tagihan</ThemedText>
                    <ThemedText type="smallBold">{formatRupiah(selectedTx.total)}</ThemedText>
                  </View>
                  <View style={styles.summaryRow}>
                    <ThemedText type="small">Uang Bayar</ThemedText>
                    <ThemedText type="small">{formatRupiah(selectedTx.cashPaid)}</ThemedText>
                  </View>
                  <View style={styles.summaryRow}>
                    <ThemedText type="smallBold" style={{ color: '#34C759' }}>
                      Kembalian
                    </ThemedText>
                    <ThemedText type="smallBold" style={{ color: '#34C759' }}>
                      {formatRupiah(selectedTx.change)}
                    </ThemedText>
                  </View>

                  {/* Receipt Actions inside Modal */}
                  <View style={[styles.cardActions, { marginTop: Spacing.four }]}>
                    <Pressable
                      style={[styles.modalActionBtn, styles.printBtn]}
                      onPress={() => handlePrint(selectedTx)}
                    >
                      <ThemedText style={styles.actionBtnText}>🖨️ Cetak Ulang Struk</ThemedText>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.modalActionBtn,
                        styles.waBtn,
                        !selectedTx.customerPhone && styles.disabledBtn,
                      ]}
                      onPress={() => handleWhatsApp(selectedTx)}
                      disabled={!selectedTx.customerPhone}
                    >
                      <ThemedText style={styles.actionBtnText}>💬 Kirim WA Ulang</ThemedText>
                    </Pressable>
                  </View>
                </ScrollView>
              )}
            </ThemedView>
          </View>
        </Modal>
        {renderCalendarModal()}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  actionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    gap: Spacing.two,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  clearBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: '#FF3B30',
  },
  clearBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  exportBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: '#34C759',
  },
  exportBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  dashboard: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
    marginBottom: Spacing.three,
  },
  statCard: {
    flex: 1,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    gap: Spacing.half,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    marginVertical: Spacing.half,
  },
  statSubText: {
    fontSize: 11,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
  },
  historyPressable: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  pressedCard: {
    opacity: 0.8,
  },
  historyCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  txId: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  txDate: {
    fontSize: 11,
  },
  txTotal: {
    fontSize: 16,
    color: '#34C759',
  },
  cardBody: {
    gap: Spacing.half,
  },
  customerName: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  cardActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  actionBtn: {
    flex: 1,
    height: 36,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  printBtn: {
    backgroundColor: '#8E8E93',
  },
  waBtn: {
    backgroundColor: '#34C759',
  },
  disabledBtn: {
    backgroundColor: '#AEAEB2',
    opacity: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderRadius: Spacing.four,
    padding: Spacing.four,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: '#EEEEEE',
    paddingBottom: Spacing.two,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E5E5EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    marginTop: Spacing.three,
  },
  detailMeta: {
    fontSize: 12,
    marginBottom: 4,
  },
  detailMetaLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: Spacing.one,
  },
  divider: {
    height: 1,
    borderStyle: 'dashed',
    borderWidth: 0.5,
    borderColor: '#8E8E93',
    marginVertical: Spacing.two,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: Spacing.half,
  },
  modalActionBtn: {
    flex: 1,
    height: 44,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterSection: {
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.three,
  },
  filterScroll: {
    gap: Spacing.two,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: 'rgba(142, 142, 147, 0.2)',
  },
  filterChipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  calendarContainer: {
    width: '100%',
    maxWidth: 340,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  monthNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(142, 142, 147, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  calendarTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
    borderBottomWidth: 1,
    borderColor: 'rgba(142, 142, 147, 0.1)',
    paddingBottom: 4,
  },
  weekdayCell: {
    width: '14.28%',
    alignItems: 'center',
  },
  weekdayText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: Spacing.three,
  },
  dayCell: {
    width: '14.28%',
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    marginVertical: 2,
  },
  dayCellActive: {
    backgroundColor: '#007AFF',
  },
  dayText: {
    fontSize: 14,
  },
  dayTextActive: {
    color: '#ffffff',
  },
  closeCalendarBtn: {
    height: 44,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(142, 142, 147, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeCalendarBtnText: {
    fontWeight: 'bold',
    fontSize: 14,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  searchContainer: {
    position: 'relative',
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
  },
  searchInput: {
    height: 44,
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 40,
    fontSize: 14,
  },
  clearSearchBtn: {
    position: 'absolute',
    right: 12,
    top: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(142, 142, 147, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
