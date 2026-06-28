import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  View,
  Alert,
  Platform,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { supabase } from '@/utils/supabase';
import * as Print from 'expo-print';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  Transaction,
  CartItem,
  formatRupiah,
  formatDateTime,
  getLocalDatePart,
  generateHTMLReceipt,
  formatWhatsAppReceipt,
} from '@/utils/receipt';
import { Linking } from 'react-native';

export default function OrdersScreen() {
  const theme = useTheme();

  const [history, setHistory] = useState<Transaction[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'completed'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [shopName, setShopName] = useState('IGA BABI MELTIQ');

  // Payment modal state
  const [payModalVisible, setPayModalVisible] = useState(false);
  const [payingTx, setPayingTx] = useState<Transaction | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'Tunai' | 'Transfer' | 'QRIS Gopay' | 'QRIS BPD'>('Tunai');
  const [cashPaid, setCashPaid] = useState('');

  // Receipt modal (after payment done)
  const [receiptModalVisible, setReceiptModalVisible] = useState(false);
  const [paidTransaction, setPaidTransaction] = useState<Transaction | null>(null);

  const loadHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          *,
          transaction_items (
            id,
            product_id,
            name,
            quantity,
            price,
            completed,
            payment_status
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
          notes: tx.notes || undefined,
          status: tx.status || undefined,
          orderType: tx.order_type || 'Dine In',
          paymentStatus: tx.payment_status || 'paid', // Legacy orders = sudah bayar
          items: (tx.transaction_items || []).map((item: any) => ({
            id: item.product_id,
            name: item.name,
            price: Number(item.price),
            quantity: item.quantity,
            completed: item.completed,
            dbId: item.id,
            paymentStatus: tx.payment_status === 'paid' ? 'paid' : (item.payment_status || 'unpaid'),
          })),
        }));
        setHistory(mappedHistory);
      }
    } catch (e) {
      console.error('Failed to load history from Supabase', e);
    }
  };

  const loadShopName = async () => {
    try {
      const { data } = await supabase.from('settings').select('*').eq('key', 'shop_name').maybeSingle();
      if (data) setShopName(data.value);
    } catch (e) {
      console.error('Error loading shop name', e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadHistory();
      loadShopName();
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

  const toggleItemCompleted = async (txId: string, itemObj: any) => {
    const txObj = history.find(t => t.id === txId);
    if (!txObj) return;

    const nextCompleted = !itemObj.completed;

    try {
      let query = supabase
        .from('transaction_items')
        .update({ completed: nextCompleted });

      if (itemObj.dbId) {
        query = query.eq('id', itemObj.dbId);
      } else {
        query = query.eq('transaction_id', txId).eq('product_id', itemObj.id);
      }

      const { error: itemError } = await query;
      if (itemError) throw itemError;

      // Update local state to compute allCompleted status correctly
      const updatedItems = txObj.items.map(item =>
        (item.dbId === itemObj.dbId || (!item.dbId && item.id === itemObj.id))
          ? { ...item, completed: nextCompleted }
          : item
      );
      const allCompleted = updatedItems.every(item => item.completed);
      const nextStatus: 'completed' | 'pending' = allCompleted ? 'completed' : 'pending';

      const { error: txError } = await supabase
        .from('transactions')
        .update({ status: nextStatus })
        .eq('id', txId);

      if (txError) throw txError;

      await loadHistory();
    } catch (e) {
      console.error('Failed to toggle item completion in Supabase', e);
      Alert.alert('Error', 'Gagal memperbarui status pesanan online.');
    }
  };

  // Cancel/delete a single item from an order
  const handleCancelItem = (txId: string, item: CartItem) => {
    Alert.alert(
      'Hapus Item',
      `Hapus "${item.name}" (${item.quantity}x) dari pesanan ini?`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: async () => {
            try {
              const txObj = history.find(t => t.id === txId);
              if (!txObj) return;

              // Delete item
              let query = supabase.from('transaction_items').delete();
              if (item.dbId) {
                query = query.eq('id', item.dbId);
              } else {
                query = query.eq('transaction_id', txId).eq('product_id', item.id);
              }

              const { error: deleteError } = await query;
              if (deleteError) throw deleteError;

              // Recalculate total
              const removedAmount = item.price * item.quantity;
              const newTotal = Math.max(0, txObj.total - removedAmount);
              const remainingItems = txObj.items.filter(i => i.dbId !== item.dbId);
              let updateData: any = { total: newTotal };

              // Recalculate change if order was paid
              if ((txObj.paymentStatus || 'paid') === 'paid' && txObj.cashPaid > 0) {
                const newChange = txObj.cashPaid - newTotal;
                updateData.change = newChange >= 0 ? newChange : 0;
              }

              // If no items left, mark completed
              if (remainingItems.length === 0) {
                updateData.status = 'completed';
                updateData.total = 0;
                updateData.payment_status = 'paid';
              }

              await supabase.from('transactions').update(updateData).eq('id', txId);

              // Restore stock
              try {
                const { data: product } = await supabase
                  .from('products').select('stock').eq('id', item.id).maybeSingle();
                if (product) {
                  await supabase.from('products')
                    .update({ stock: product.stock + item.quantity }).eq('id', item.id);
                }
              } catch (stockErr) {
                console.warn('Could not restore stock:', stockErr);
              }

              await loadHistory();
            } catch (e) {
              console.error('Failed to cancel item', e);
              Alert.alert('Error', 'Gagal menghapus item pesanan.');
            }
          },
        },
      ]
    );
  };

  // Cancel an entire order
  const handleCancelOrder = (txId: string) => {
    Alert.alert(
      'Batalkan Pesanan',
      `Apakah Anda yakin ingin membatalkan dan menghapus pesanan ${txId} secara permanen?`,
      [
        { text: 'Kembali', style: 'cancel' },
        {
          text: 'Hapus Pesanan',
          style: 'destructive',
          onPress: async () => {
            try {
              const txObj = history.find(t => t.id === txId);
              if (!txObj) return;

              // Restore stock for all items
              for (const item of txObj.items) {
                try {
                  const { data: product } = await supabase
                    .from('products').select('stock').eq('id', item.id).maybeSingle();
                  if (product) {
                    await supabase.from('products')
                      .update({ stock: product.stock + item.quantity }).eq('id', item.id);
                  }
                } catch (stockErr) {
                  console.warn('Could not restore stock for item', item.id, stockErr);
                }
              }

              // Delete items and transaction
              const { error: itemsError } = await supabase.from('transaction_items').delete().eq('transaction_id', txId);
              if (itemsError) throw itemsError;

              const { error: txError } = await supabase.from('transactions').delete().eq('id', txId);
              if (txError) throw txError;

              await loadHistory();
            } catch (e) {
              console.error('Failed to cancel order', e);
              Alert.alert('Error', 'Gagal membatalkan pesanan.');
            }
          },
        },
      ]
    );
  };

  // Open payment modal
  const handleOpenPay = (tx: Transaction) => {
    setPayingTx(tx);
    setPaymentMethod('Tunai');
    setCashPaid('');
    setPayModalVisible(true);
  };

  // Process payment for an existing unpaid order
  const handleProcessPayment = async () => {
    if (!payingTx) return;
    const unpaidAmount = payingTx.items.filter(i => i.paymentStatus === 'unpaid').reduce((sum, item) => sum + item.price * item.quantity, 0);
    const paid = paymentMethod === 'Tunai' ? parseFloat(cashPaid) : unpaidAmount;

    if (paymentMethod === 'Tunai' && (isNaN(paid) || paid < unpaidAmount)) {
      Alert.alert('Pembayaran Kurang', 'Jumlah uang bayar kurang dari total belanja.');
      return;
    }

    const change = paymentMethod === 'Tunai' ? paid - unpaidAmount : 0;
    const newCashPaid = payingTx.cashPaid + paid;
    const newChange = payingTx.change + change;

    try {
      const { error } = await supabase
        .from('transactions')
        .update({
          cash_paid: newCashPaid,
          change: newChange,
          payment_method: paymentMethod,
          payment_status: 'paid',
        })
        .eq('id', payingTx.id);

      if (error) throw error;

      // Also mark all items as paid
      await supabase
        .from('transaction_items')
        .update({ payment_status: 'paid' })
        .eq('transaction_id', payingTx.id);

      const paidTx: Transaction = {
        ...payingTx,
        cashPaid: newCashPaid,
        change: newChange,
        paymentMethod,
        paymentStatus: 'paid',
      };

      setPaidTransaction(paidTx);
      setPayModalVisible(false);
      setPayingTx(null);
      setReceiptModalVisible(true);
      await loadHistory();
    } catch (e) {
      console.error('Failed to process payment', e);
      Alert.alert('Error', 'Gagal memproses pembayaran.');
    }
  };

  const handlePrint = async () => {
    if (!paidTransaction) return;
    try {
      const html = generateHTMLReceipt(paidTransaction, shopName);
      await Print.printAsync({ html });
    } catch {
      Alert.alert('Error', 'Gagal mencetak struk');
    }
  };

  const handleWhatsApp = () => {
    if (!paidTransaction) return;
    const phone = paidTransaction.customerPhone || '';
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.slice(1);
    }
    const text = formatWhatsAppReceipt(paidTransaction, shopName);
    const url = `https://wa.me/${cleanPhone}?text=${text}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Gagal membuka WhatsApp.');
    });
  };

  // Filtering transactions
  const getFilteredOrders = () => {
    let list = history;

    list = list.filter((tx) => {
      const status = tx.status || 'completed';
      return status === statusFilter;
    });

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

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      list = list.filter(tx => 
        tx.id.toLowerCase().includes(query) ||
        (tx.customerName && tx.customerName.toLowerCase().includes(query)) ||
        (tx.notes && tx.notes.toLowerCase().includes(query)) ||
        (tx.paymentMethod && tx.paymentMethod.toLowerCase().includes(query))
      );
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
            Aktif ({pending})
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
                <ThemedText style={styles.monthNavText}>{'<'}</ThemedText>
              </Pressable>
              <ThemedText type="smallBold" style={styles.calendarTitle}>
                {MONTH_NAMES[calendarMonth]} {calendarYear}
              </ThemedText>
              <Pressable onPress={handleNextMonth} style={styles.monthNavBtn}>
                <ThemedText style={styles.monthNavText}>{'>'}</ThemedText>
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

  // Payment Modal
  const renderPayModal = () => {
    if (!payingTx) return null;
    const unpaidAmount = payingTx.items.filter(i => i.paymentStatus === 'unpaid').reduce((sum, item) => sum + item.price * item.quantity, 0);
    const paid = parseFloat(cashPaid);
    const change = !isNaN(paid) && paid >= unpaidAmount ? paid - unpaidAmount : 0;
    const canPay = paymentMethod !== 'Tunai' || (!isNaN(paid) && paid >= unpaidAmount);

    return (
      <Modal
        animationType="slide"
        transparent={true}
        visible={payModalVisible}
        onRequestClose={() => setPayModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView type="backgroundElement" style={styles.payModalContent}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.two }}>
              <ThemedText type="smallBold" style={[styles.payModalTitle, { flex: 1 }]}>
                💳 Pembayaran
              </ThemedText>
              <Pressable
                style={styles.closeIconBtn}
                onPress={() => setPayModalVisible(false)}
              >
                <ThemedText style={{ fontSize: 18, fontWeight: 'bold' }}>×</ThemedText>
              </Pressable>
            </View>

            {/* Order info */}
            <View style={styles.payOrderInfo}>
              <ThemedText type="smallBold" style={{ fontSize: 14 }}>
                {payingTx.customerName || 'Tanpa Nama'}
                {payingTx.orderType ? ` · ${payingTx.orderType === 'Takeaway' ? '🥡' : '🍽️'} ${payingTx.orderType}` : ''}
              </ThemedText>
              <ThemedText type="code" themeColor="textSecondary" style={{ fontSize: 11, marginTop: 2 }}>
                {payingTx.id} · {payingTx.items.length} item
              </ThemedText>
            </View>

            {/* Total */}
            <View style={styles.tagihanContainer}>
              <ThemedText type="small" themeColor="textSecondary">Total Tagihan:</ThemedText>
              <ThemedText style={styles.tagihanTotal}>{formatRupiah(unpaidAmount)}</ThemedText>
            </View>

            {/* Metode Pembayaran */}
            <View style={styles.formGroup}>
              <ThemedText type="small" style={styles.label}>Metode Pembayaran</ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.paymentChipsScroll}
              >
                {(['Tunai', 'Transfer', 'QRIS Gopay', 'QRIS BPD'] as const).map((method) => {
                  const isSelected = paymentMethod === method;
                  return (
                    <Pressable
                      key={method}
                      style={[
                        styles.paymentChip,
                        { backgroundColor: isSelected ? '#34C759' : theme.backgroundSelected },
                      ]}
                      onPress={() => {
                        setPaymentMethod(method);
                        if (method !== 'Tunai') setCashPaid(String(unpaidAmount));
                        else setCashPaid('');
                      }}
                    >
                      <ThemedText
                        type="smallBold"
                        style={{ color: isSelected ? '#ffffff' : theme.text, fontSize: 13 }}
                      >
                        {method}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Input uang tunai */}
            {paymentMethod === 'Tunai' ? (
              <View style={styles.formGroup}>
                <ThemedText type="small" style={styles.label}>Uang Tunai Bayar (Rp)</ThemedText>
                <TextInput
                  style={[
                    styles.cashInput,
                    {
                      backgroundColor: theme.background,
                      color: theme.text,
                      borderColor: theme.backgroundSelected,
                    },
                  ]}
                  value={cashPaid}
                  onChangeText={setCashPaid}
                  placeholder={`Min. ${formatRupiah(unpaidAmount)}`}
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="numeric"
                  autoFocus
                />

                {!isNaN(paid) && paid >= unpaidAmount && (
                  <View style={styles.kembalianBox}>
                    <ThemedText type="small" style={{ color: '#34C759' }}>Kembalian:</ThemedText>
                    <ThemedText type="smallBold" style={styles.kembalianVal}>
                      {formatRupiah(change)}
                    </ThemedText>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.nonCashBox}>
                <ThemedText type="small" themeColor="textSecondary">
                  Pembayaran {paymentMethod}:
                </ThemedText>
                <ThemedText type="smallBold" style={{ color: '#34C759', fontSize: 16, marginTop: 4 }}>
                  {formatRupiah(unpaidAmount)} (Lunas)
                </ThemedText>
              </View>
            )}

            {/* Actions - stacked vertically */}
            <Pressable
              style={[styles.confirmPayBtn, !canPay && styles.disabledBtn, { marginTop: Spacing.two }]}
              onPress={handleProcessPayment}
              disabled={!canPay}
            >
              <ThemedText style={styles.confirmPayBtnText}>✅ Bayar Sekarang</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.cancelPayBtnFull, { marginTop: Spacing.two }]}
              onPress={() => setPayModalVisible(false)}
            >
              <ThemedText style={styles.cancelPayBtnText}>Batal</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>
    );
  };

  // Receipt Modal after payment
  const renderReceiptModal = () => {
    if (!paidTransaction) return null;
    return (
      <Modal
        animationType="fade"
        transparent={true}
        visible={receiptModalVisible}
        onRequestClose={() => setReceiptModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ThemedView type="backgroundElement" style={styles.receiptModalContent}>
            <Pressable
              style={styles.absoluteCloseBtn}
              onPress={() => setReceiptModalVisible(false)}
            >
              <ThemedText style={{ fontSize: 24, fontWeight: 'bold', lineHeight: 26 }}>×</ThemedText>
            </Pressable>

            <View style={styles.successIconContainer}>
              <View style={styles.successIconMark} />
            </View>
            <ThemedText type="smallBold" style={[styles.payModalTitle, { textAlign: 'center' }]}>
              Pembayaran Berhasil!
            </ThemedText>

            <ScrollView style={styles.receiptSummary}>
              <ThemedText type="code" style={{ textAlign: 'center', marginBottom: Spacing.two }}>
                No. Struk: {paidTransaction.id}
              </ThemedText>
              {paidTransaction.cashierName && (
                <ThemedText type="code" style={{ textAlign: 'center', marginBottom: Spacing.two }}>
                  Kasir: {paidTransaction.cashierName}
                </ThemedText>
              )}
              <View style={styles.divider} />

              {paidTransaction.items.map((item) => (
                <View key={item.dbId || item.id} style={styles.receiptItem}>
                  <ThemedText type="small" style={{ flex: 1 }}>{item.name}</ThemedText>
                  <ThemedText type="small">
                    {item.quantity}x {formatRupiah(item.price)}
                  </ThemedText>
                </View>
              ))}

              <View style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: theme.textSecondary, marginVertical: 8 }} />

              <View style={styles.receiptRow}>
                <ThemedText type="smallBold">Total</ThemedText>
                <ThemedText type="smallBold">{formatRupiah(paidTransaction.total)}</ThemedText>
              </View>
              <View style={styles.receiptRow}>
                <ThemedText type="small">Bayar</ThemedText>
                <ThemedText type="small">{formatRupiah(paidTransaction.cashPaid)}</ThemedText>
              </View>
              <View style={styles.receiptRow}>
                <ThemedText type="smallBold" style={{ color: '#34C759' }}>Kembalian</ThemedText>
                <ThemedText type="smallBold" style={{ color: '#34C759' }}>{formatRupiah(paidTransaction.change)}</ThemedText>
              </View>
              <View style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: theme.textSecondary, marginVertical: 8 }} />
              <View style={styles.receiptRow}>
                <ThemedText type="small">Metode Bayar</ThemedText>
                <ThemedText type="smallBold">{paidTransaction.paymentMethod}</ThemedText>
              </View>
            </ScrollView>

            <View style={styles.receiptActions}>
              <Pressable style={[styles.receiptBtn, styles.printBtn]} onPress={handlePrint}>
                <ThemedText style={styles.receiptBtnText}>🖨️ Cetak</ThemedText>
              </Pressable>
              <Pressable
                style={[
                  styles.receiptBtn,
                  styles.waBtn,
                  !paidTransaction?.customerPhone && styles.disabledReceiptBtn,
                ]}
                onPress={handleWhatsApp}
                disabled={!paidTransaction?.customerPhone}
              >
                <ThemedText style={styles.receiptBtnText}>💬 WhatsApp</ThemedText>
              </Pressable>
            </View>

            <Pressable
              style={styles.doneBtn}
              onPress={() => setReceiptModalVisible(false)}
            >
              <ThemedText style={styles.doneBtnText}>Selesai</ThemedText>
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

        {/* Search Bar */}
        <View style={styles.searchSection}>
          <TextInput
            style={[
              styles.searchInput,
              {
                backgroundColor: theme.background,
                color: theme.text,
                borderColor: theme.backgroundSelected,
              },
            ]}
            placeholder="Cari nama, No. Order, catatan..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
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
              const unpaidAmount = tx.items.filter(i => i.paymentStatus === 'unpaid').reduce((sum, item) => sum + item.price * item.quantity, 0);
              const isPaid = unpaidAmount === 0;
              const orderTypeLabel = tx.orderType || 'Dine In';
              const isTakeaway = orderTypeLabel === 'Takeaway';

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

                    {/* Badges row */}
                    <View style={styles.badgesRow}>
                      {/* Order type badge */}
                      <View
                        style={[
                          styles.badge,
                          { backgroundColor: isTakeaway ? 'rgba(255, 149, 0, 0.12)' : 'rgba(0, 122, 255, 0.12)' }
                        ]}
                      >
                        <ThemedText
                          style={{
                            fontSize: 10,
                            fontWeight: '700',
                            color: isTakeaway ? '#FF9500' : '#007AFF',
                          }}
                        >
                          {isTakeaway ? '🥡 Takeaway' : '🍽️ Dine In'}
                        </ThemedText>
                      </View>

                      {/* Status order badge */}
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
                          {isCompleted ? '✓ Selesai' : '⏳ Aktif'}
                        </ThemedText>
                      </View>
                    </View>
                  </View>

                  {/* Payment Status Banner */}
                  <View
                    style={[
                      styles.paymentStatusBanner,
                      {
                        backgroundColor: isPaid
                          ? 'rgba(52, 199, 89, 0.08)'
                          : 'rgba(255, 59, 48, 0.08)',
                        borderColor: isPaid
                          ? 'rgba(52, 199, 89, 0.3)'
                          : 'rgba(255, 59, 48, 0.3)',
                      }
                    ]}
                  >
                    <ThemedText
                      type="smallBold"
                      style={{
                        fontSize: 12,
                        color: isPaid ? '#34C759' : '#FF3B30',
                        flex: 1,
                      }}
                    >
                      {isPaid ? '✅ Sudah Bayar' : '❌ Belum Bayar'}
                    </ThemedText>
                    {isPaid && (
                      <ThemedText type="code" style={{ fontSize: 11, color: '#34C759' }}>
                        {tx.paymentMethod || 'Tunai'} · {formatRupiah(tx.cashPaid)}
                      </ThemedText>
                    )}
                    {!isPaid && (
                      <ThemedText type="smallBold" style={{ fontSize: 13, color: '#FF3B30' }}>
                        {formatRupiah(unpaidAmount)}
                      </ThemedText>
                    )}
                  </View>

                  {/* Customer Info */}
                  <View style={styles.customerInfo}>
                    <ThemedText type="smallBold" style={{ fontSize: 14 }}>
                      {tx.customerName || '-'}
                    </ThemedText>
                    {tx.customerPhone && (
                      <ThemedText type="code" themeColor="textSecondary">
                        WA: {tx.customerPhone}
                      </ThemedText>
                    )}
                    {tx.cashierName && (
                      <ThemedText type="code" themeColor="textSecondary" style={{ fontSize: 11 }}>
                        Kasir: {tx.cashierName}
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
                        <View key={item.dbId || item.id} style={styles.itemRow}>
                          <Pressable
                            style={[
                              styles.checkbox,
                              isItemCompleted && styles.checkboxChecked
                            ]}
                            onPress={() => toggleItemCompleted(tx.id, item)}
                          >
                            {isItemCompleted && (
                              <ThemedText style={styles.checkboxCheckmark}>✓</ThemedText>
                            )}
                          </Pressable>

                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <ThemedText
                              type="smallBold"
                              style={[
                                styles.itemName,
                                isItemCompleted && styles.completedItemText
                              ]}
                            >
                              {item.name}
                              {item.paymentStatus === 'unpaid' ? (
                                <ThemedText style={{ color: '#FF3B30', fontSize: 11, fontWeight: '700' }}> (Belum Bayar)</ThemedText>
                              ) : (
                                <ThemedText style={{ color: '#34C759', fontSize: 11, fontWeight: '700' }}> (Sudah Bayar)</ThemedText>
                              )}
                            </ThemedText>
                            <ThemedText
                              type="small"
                              themeColor="textSecondary"
                              style={isItemCompleted ? styles.completedItemText : undefined}
                            >
                              {item.quantity}x · {formatRupiah(item.price * item.quantity)}
                            </ThemedText>
                          </View>

                          {/* Cancel item button */}
                          {!isCompleted && (
                            <Pressable
                              style={styles.cancelItemBtn}
                              onPress={() => handleCancelItem(tx.id, item)}
                            >
                              <ThemedText style={styles.cancelItemBtnText}>🗑️</ThemedText>
                            </Pressable>
                          )}
                        </View>
                      );
                    })}
                  </View>

                  {/* Notes */}
                  {tx.notes && (
                    <View style={styles.notesBox}>
                      <ThemedText type="small" style={{ fontStyle: 'italic', fontSize: 13 }} themeColor="textSecondary">
                        📝 {tx.notes}
                      </ThemedText>
                    </View>
                  )}

                  {/* Footer & Action Buttons */}
                  <View style={styles.cardFooter}>
                    <View style={styles.cardFooterLeft}>
                      <ThemedText type="smallBold" style={{ fontSize: 14, color: '#34C759' }}>
                        Total: {formatRupiah(tx.total)}
                      </ThemedText>
                    </View>

                    {/* Action buttons for pending/unpaid orders */}
                    {!isCompleted && (
                      <View style={styles.cardActionBtns}>
                        <Pressable
                          style={styles.cancelOrderBtn}
                          onPress={() => handleCancelOrder(tx.id)}
                        >
                          <ThemedText style={styles.cancelOrderBtnText}>Batalkan</ThemedText>
                        </Pressable>

                        {/* Bayar button - only if unpaid */}
                        {!isPaid && (
                          <Pressable
                            style={styles.payNowBtn}
                            onPress={() => handleOpenPay(tx)}
                          >
                            <ThemedText style={styles.payNowBtnText}>💳 Bayar</ThemedText>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                </ThemedView>
              );
            })
          )}
        </ScrollView>

        {renderCalendarModal()}
        {renderPayModal()}
        {renderReceiptModal()}
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
  searchSection: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  searchInput: {
    height: 48,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
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
    gap: Spacing.two,
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
  badgesRow: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 4,
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
  paymentStatusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
  customerInfo: {
    paddingVertical: Spacing.one,
    borderBottomWidth: 1,
    borderColor: 'rgba(142, 142, 147, 0.1)',
    gap: 2,
    paddingBottom: Spacing.two,
  },
  itemsSection: {
    paddingVertical: Spacing.one,
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
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderColor: 'rgba(142, 142, 147, 0.1)',
  },
  cardFooterLeft: {
    flex: 1,
  },
  cardActionBtns: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  payNowBtn: {
    backgroundColor: '#34C759',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payNowBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  cancelOrderBtn: {
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    borderWidth: 1,
    borderColor: '#FF3B30',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelOrderBtnText: {
    color: '#FF3B30',
    fontWeight: 'bold',
    fontSize: 13,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  payModalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 28,
    padding: Spacing.four + 8,
    gap: Spacing.two + 4,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
  },
  payModalTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: Spacing.one,
  },
  payOrderInfo: {
    padding: Spacing.three,
    backgroundColor: 'rgba(142, 142, 147, 0.07)',
    borderRadius: Spacing.three,
  },
  tagihanContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.three + 4,
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
    borderRadius: Spacing.three,
  },
  tagihanTotal: {
    fontSize: 34,
    fontWeight: '800',
    color: '#007AFF',
    marginTop: Spacing.one,
  },
  formGroup: {
    gap: Spacing.one + 2,
  },
  label: {
    fontWeight: '700',
    fontSize: 14,
    color: '#8E8E93',
  },
  paymentChipsScroll: {
    paddingVertical: Spacing.one,
    gap: Spacing.two,
  },
  paymentChip: {
    paddingHorizontal: Spacing.three + 4,
    paddingVertical: Spacing.two + 2,
    borderRadius: 100,
    marginRight: Spacing.one,
  },
  cashInput: {
    height: 56,
    borderWidth: 1.5,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 22,
    fontWeight: 'bold',
  },
  kembalianBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
    borderRadius: Spacing.three,
    marginTop: Spacing.one,
  },
  kembalianVal: {
    fontSize: 20,
    color: '#34C759',
    fontWeight: '800',
  },
  nonCashBox: {
    padding: Spacing.three,
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
    borderRadius: Spacing.three,
  },
  payActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  payBtn: {
    flex: 1,
    height: 54,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelPayBtn: {
    backgroundColor: 'rgba(142, 142, 147, 0.1)',
  },
  cancelPayBtnText: {
    color: '#8E8E93',
    fontWeight: '700',
    fontSize: 16,
  },
  confirmPayBtn: {
    height: 54,
    backgroundColor: '#34C759',
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#34C759',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmPayBtnText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 16,
  },
  cancelPayBtnFull: {
    height: 54,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(142, 142, 147, 0.1)',
  },
  disabledBtn: {
    backgroundColor: '#AEAEB2',
    opacity: 0.8,
    shadowOpacity: 0,
    elevation: 0,
  },
  // Receipt modal
  receiptModalContent: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '90%',
    borderRadius: Spacing.four,
    padding: Spacing.four,
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
  },
  absoluteCloseBtn: {
    position: 'absolute',
    right: 16,
    top: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(142, 142, 147, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  receiptSummary: {
    width: '100%',
    maxHeight: 280,
    flexShrink: 1,
    marginTop: Spacing.two,
    padding: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.02)',
    borderRadius: Spacing.two,
  },
  divider: {
    height: 1,
    borderStyle: 'dashed',
    borderWidth: 0.5,
    borderColor: '#8E8E93',
    marginVertical: Spacing.two,
  },
  receiptItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 2,
  },
  receiptActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    width: '100%',
    marginTop: Spacing.three,
  },
  receiptBtn: {
    flex: 1,
    height: 44,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printBtn: {
    backgroundColor: '#8E8E93',
  },
  waBtn: {
    backgroundColor: '#34C759',
  },
  disabledReceiptBtn: {
    backgroundColor: '#AEAEB2',
    opacity: 0.5,
  },
  receiptBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  successIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: Spacing.two,
    shadowColor: '#34C759',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  successIconMark: {
    width: 24,
    height: 12,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderColor: '#ffffff',
    transform: [{ rotate: '-45deg' }, { translateY: -4 }],
  },
  doneBtn: {
    width: '100%',
    height: 48,
    backgroundColor: '#007AFF',
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.three,
  },
  doneBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  // Calendar
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
  cancelItemBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  cancelItemBtnText: {
    fontSize: 16,
  },

  closeIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(142, 142, 147, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
