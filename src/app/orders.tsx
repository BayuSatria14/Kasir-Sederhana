import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  View,
  Alert,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/utils/supabase';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  Transaction,
  formatRupiah,
  formatDateTime,
  getLocalDatePart,
} from '@/utils/receipt';

export default function OrdersScreen() {
  const theme = useTheme();

  const [history, setHistory] = useState<Transaction[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'completed'>('pending');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());

  // Load history on tab focus
  const loadHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          *,
          transaction_items (
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
          paymentMethod: tx.payment_method || undefined,
          notes: tx.notes || undefined,
          status: tx.status || undefined,
          items: (tx.transaction_items || []).map((item: any) => ({
            id: item.product_id,
            name: item.name,
            price: Number(item.price),
            quantity: item.quantity,
            completed: item.completed,
          })),
        }));
        setHistory(mappedHistory);
      }
    } catch (e) {
      console.error('Failed to load history from Supabase', e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [])
  );

  // Realtime: auto-sync orders queue across devices
  useEffect(() => {
    const channel = supabase
      .channel('orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        loadHistory();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transaction_items' }, () => {
        loadHistory();
      })
      .subscribe((status, err) => {
        console.log('Realtime (orders.tsx) Status:', status, err ? err : '');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const toggleItemCompleted = async (txId: string, itemId: string) => {
    const txObj = history.find(t => t.id === txId);
    if (!txObj) return;
    const itemObj = txObj.items.find(i => i.id === itemId);
    if (!itemObj) return;

    const nextCompleted = !itemObj.completed;

    try {
      // 1. Update item status in Supabase
      const { error: itemError } = await supabase
        .from('transaction_items')
        .update({ completed: nextCompleted })
        .eq('transaction_id', txId)
        .eq('product_id', itemId);
      
      if (itemError) throw itemError;

      // 2. Determine and update overall transaction status
      const updatedItems = txObj.items.map(item =>
        item.id === itemId ? { ...item, completed: nextCompleted } : item
      );
      const allCompleted = updatedItems.every(item => item.completed);
      const nextStatus: 'completed' | 'pending' = allCompleted ? 'completed' : 'pending';

      const { error: txError } = await supabase
        .from('transactions')
        .update({ status: nextStatus })
        .eq('id', txId);

      if (txError) throw txError;

      // 3. Reload history to sync state
      await loadHistory();
    } catch (e) {
      console.error('Failed to toggle item completion in Supabase', e);
      Alert.alert('Error', 'Gagal memperbarui status pesanan online.');
    }
  };

  // Filtering transactions
  // 1. By status and date
  const getFilteredOrders = () => {
    let list = history;

    // Status Filter
    list = list.filter((tx) => {
      const status = tx.status || 'completed'; // Legacy orders are marked completed
      return status === statusFilter;
    });

    // Date Filter (apply date filter to both pending and completed orders)
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

    return list;
  };

  const filteredOrders = getFilteredOrders();

  const getPendingCount = () => {
    return history.filter((tx) => (tx.status || 'completed') === 'pending').length;
  };

  const getCompletedCount = () => {
    return history.filter((tx) => (tx.status || 'completed') === 'completed').length;
  };

  const renderStatusTabs = () => {
    const pending = getPendingCount();
    const completed = getCompletedCount();

    return (
      <View style={[styles.tabContainer, { backgroundColor: theme.backgroundElement }]}>
        <Pressable
          style={[
            styles.tabBtn,
            statusFilter === 'pending' && styles.tabBtnActivePending,
            { borderRightWidth: 1, borderColor: 'rgba(142, 142, 147, 0.2)' }
          ]}
          onPress={() => setStatusFilter('pending')}
        >
          <ThemedText
            type="smallBold"
            style={{ color: statusFilter === 'pending' ? '#FF9500' : theme.textSecondary }}
          >
            Belum Selesai ({pending})
          </ThemedText>
        </Pressable>

        <Pressable
          style={[
            styles.tabBtn,
            statusFilter === 'completed' && styles.tabBtnActiveCompleted,
          ]}
          onPress={() => setStatusFilter('completed')}
        >
          <ThemedText
            type="smallBold"
            style={{ color: statusFilter === 'completed' ? '#34C759' : theme.textSecondary }}
          >
            Selesai ({completed})
          </ThemedText>
        </Pressable>
      </View>
    );
  };

  const renderDateFilters = () => {
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
      <View style={styles.dateFilterSection}>
        <ThemedText type="code" themeColor="textSecondary" style={{ marginBottom: Spacing.one }}>
          Filter Tanggal:
        </ThemedText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
          <Pressable
            style={[styles.dateChip, { backgroundColor: theme.backgroundElement }, isSemua && styles.dateChipActive]}
            onPress={() => setSelectedDate(null)}
          >
            <ThemedText type="smallBold" style={{ color: isSemua ? '#ffffff' : theme.text }}>
              Semua
            </ThemedText>
          </Pressable>

          <Pressable
            style={[styles.dateChip, { backgroundColor: theme.backgroundElement }, isHariIni && styles.dateChipActive]}
            onPress={() => setSelectedDate('today')}
          >
            <ThemedText type="smallBold" style={{ color: isHariIni ? '#ffffff' : theme.text }}>
              Hari Ini
            </ThemedText>
          </Pressable>

          <Pressable
            style={[styles.dateChip, { backgroundColor: theme.backgroundElement }, isKemarin && styles.dateChipActive]}
            onPress={() => setSelectedDate('yesterday')}
          >
            <ThemedText type="smallBold" style={{ color: isKemarin ? '#ffffff' : theme.text }}>
              Kemarin
            </ThemedText>
          </Pressable>

          <Pressable
            style={[styles.dateChip, { backgroundColor: theme.backgroundElement }, isKustom && styles.dateChipActive]}
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

            <View style={weekdayRowStyle}>
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

  const weekdayRowStyle = [styles.weekdayRow, { borderBottomWidth: 1, borderColor: 'rgba(142, 142, 147, 0.1)', paddingBottom: 4 }];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={styles.header}>
          <ThemedText type="subtitle" style={styles.headerTitle}>
            Antrean Pesanan
          </ThemedText>
        </View>

        {/* Status Filter Tab */}
        {renderStatusTabs()}

        {/* Date Filter */}
        {renderDateFilters()}

        {/* Order Cards Queue */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          {filteredOrders.length === 0 ? (
            <View style={styles.emptyState}>
              <ThemedText themeColor="textSecondary">
                {statusFilter === 'pending'
                  ? 'Tidak ada pesanan aktif.'
                  : 'Tidak ada riwayat pesanan selesai.'}
              </ThemedText>
            </View>
          ) : (
            filteredOrders.map((tx) => {
              const isCompleted = (tx.status || 'completed') === 'completed';
              return (
                <ThemedView
                  key={tx.id}
                  type="backgroundElement"
                  style={[
                    styles.orderCard,
                    isCompleted && styles.completedCardOpacity
                  ]}
                >
                  {/* Card Header */}
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="smallBold" style={styles.txId}>
                        {tx.id}
                      </ThemedText>
                      <ThemedText type="code" themeColor="textSecondary" style={{ fontSize: 11 }}>
                        {formatDateTime(tx.date)}
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: isCompleted
                            ? 'rgba(52, 199, 89, 0.12)'
                            : 'rgba(255, 149, 0, 0.12)'
                        }
                      ]}
                    >
                      <ThemedText
                        style={{
                          fontSize: 10,
                          fontWeight: '700',
                          color: isCompleted ? '#34C759' : '#FF9500'
                        }}
                      >
                        {isCompleted ? 'Selesai' : 'Aktif'}
                      </ThemedText>
                    </View>
                  </View>

                  {/* Customer Info */}
                  <View style={styles.customerInfo}>
                    <ThemedText type="smallBold" style={{ fontSize: 14 }}>
                      Pelanggan: {tx.customerName || '-'}
                    </ThemedText>
                    {tx.customerPhone && (
                      <ThemedText type="code" themeColor="textSecondary">
                        WA: {tx.customerPhone}
                      </ThemedText>
                    )}
                  </View>

                  {/* Items List with Checklist */}
                  <View style={styles.itemsSection}>
                    <ThemedText type="code" themeColor="textSecondary" style={{ marginBottom: Spacing.one }}>
                      Item Pesanan:
                    </ThemedText>
                    {tx.items.map((item) => {
                      const isItemCompleted = item.completed ?? false;
                      return (
                        <View key={item.id} style={styles.itemRow}>
                          <Pressable
                            style={[
                              styles.checkbox,
                              isItemCompleted && styles.checkboxChecked
                            ]}
                            onPress={() => toggleItemCompleted(tx.id, item.id)}
                          >
                            {isItemCompleted && (
                              <ThemedText style={styles.checkboxCheckmark}>✓</ThemedText>
                            )}
                          </Pressable>

                          <View style={{ flex: 1, marginLeft: 12 }}>
                            <ThemedText
                              type="smallBold"
                              style={[
                                styles.itemName,
                                isItemCompleted && styles.completedItemText
                              ]}
                            >
                              {item.name}
                            </ThemedText>
                            <ThemedText
                              type="small"
                              themeColor="textSecondary"
                              style={isItemCompleted && styles.completedItemText}
                            >
                              Jumlah: {item.quantity}x
                            </ThemedText>
                          </View>
                        </View>
                      );
                    })}
                  </View>

                  {/* Notes & Footer */}
                  {tx.notes && (
                    <View style={styles.notesBox}>
                      <ThemedText type="small" style={{ fontStyle: 'italic', fontSize: 13 }} themeColor="textSecondary">
                        Catatan: {tx.notes}
                      </ThemedText>
                    </View>
                  )}

                  <View style={styles.cardFooter}>
                    <ThemedText type="code" style={{ fontSize: 11 }} themeColor="textSecondary">
                      Kasir: {tx.cashierName || 'Sistem'} • Bayar: {tx.paymentMethod || 'Tunai'}
                    </ThemedText>
                  </View>
                </ThemedView>
              );
            })
          )}
        </ScrollView>
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
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    borderRadius: Spacing.two,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(142, 142, 147, 0.2)',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActivePending: {
    backgroundColor: 'rgba(255, 149, 0, 0.08)',
  },
  tabBtnActiveCompleted: {
    backgroundColor: 'rgba(52, 199, 89, 0.08)',
  },
  dateFilterSection: {
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.three,
  },
  dateChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: 'rgba(142, 142, 147, 0.2)',
  },
  dateChipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  emptyState: {
    paddingVertical: Spacing.six,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  completedCardOpacity: {
    opacity: 0.85,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderColor: 'rgba(142, 142, 147, 0.1)',
    paddingBottom: Spacing.two,
  },
  txId: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  customerInfo: {
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    borderColor: 'rgba(142, 142, 147, 0.1)',
    gap: 2,
  },
  itemsSection: {
    paddingVertical: Spacing.two,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.one,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#8E8E93',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkboxChecked: {
    borderColor: '#34C759',
    backgroundColor: '#34C759',
  },
  checkboxCheckmark: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    lineHeight: 18,
  },
  itemName: {
    fontSize: 14,
  },
  completedItemText: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  notesBox: {
    padding: Spacing.two,
    backgroundColor: 'rgba(142, 142, 147, 0.05)',
    borderRadius: Spacing.two,
    marginBottom: Spacing.two,
  },
  cardFooter: {
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderColor: 'rgba(142, 142, 147, 0.1)',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
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
});
