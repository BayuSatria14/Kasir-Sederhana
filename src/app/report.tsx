import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  View,
  TextInput,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
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
type PaymentGroup = 'qris' | 'transfer' | 'cash';

export default function ReportScreen() {
  const theme = useTheme();
  const [history, setHistory] = useState<Transaction[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('today');
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [activeGroup, setActiveGroup] = useState<PaymentGroup>('qris');
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);
  const [loadingRef, setLoadingRef] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const isQrisMethod = (method: string) => method.toLowerCase().includes('qris');
  const isTransferMethod = (method: string) => method.toLowerCase().includes('transfer');

  const handleOpenDetail = async (tx: Transaction) => {
    setDetailTx(tx);
    const isQris = isQrisMethod(tx.paymentMethod || '');
    const isTransfer = isTransferMethod(tx.paymentMethod || '');

    if (isQris || isTransfer) {
      setLoadingRef(true);
      const { data } = await supabase.from('transactions').select('payment_ref').eq('id', tx.id).maybeSingle();
      if (data && data.payment_ref) {
        setDetailTx(prev => prev ? { ...prev, paymentRef: data.payment_ref } : null);
      }
      setLoadingRef(false);
    }
  };

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
        const mapped: Transaction[] = data.map((tx: any) => ({
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
        setHistory(mapped);
      }
    } catch (e) {
      console.error('Failed to load report history', e);
    }
  };

  useFocusEffect(useCallback(() => { loadHistory(); }, []));

  useEffect(() => {
    const channel = supabase
      .channel('report-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, loadHistory)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const todayStr = getLocalDatePart();
  const yesterdayStr = getLocalDatePart(new Date(Date.now() - 86400000));
  const activeTargetDate =
    selectedDate === 'today' ? todayStr :
      selectedDate === 'yesterday' ? yesterdayStr :
        selectedDate;

  const getFilteredByDate = () => {
    let list = history.filter((tx) => getLocalDatePart(tx.date) === activeTargetDate);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((tx) =>
        tx.id.toLowerCase().includes(q) ||
        (tx.customerName?.toLowerCase().includes(q))
      );
    }
    return list;
  };

  const filtered = getFilteredByDate();
  const qrisTxs = filtered.filter((tx) => isQrisMethod(tx.paymentMethod || ''));
  const transferTxs = filtered.filter((tx) => isTransferMethod(tx.paymentMethod || ''));
  const cashTxs = filtered.filter((tx) => !isQrisMethod(tx.paymentMethod || '') && !isTransferMethod(tx.paymentMethod || ''));

  const qrisTotal = qrisTxs.reduce((s, tx) => s + tx.total, 0);
  const transferTotal = transferTxs.reduce((s, tx) => s + tx.total, 0);
  const cashTotal = cashTxs.reduce((s, tx) => s + tx.total, 0);
  const grandTotal = qrisTotal + transferTotal + cashTotal;

  const getDateLabel = () => {
    if (selectedDate === 'today') return 'Hari Ini';
    if (selectedDate === 'yesterday') return 'Kemarin';
    const parts = selectedDate.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return selectedDate;
  };

  const activeTxs = activeGroup === 'qris' ? qrisTxs : activeGroup === 'transfer' ? transferTxs : cashTxs;

  // ─── Export Excel ─────────────────────────────────────────────────────────
  const handleExportExcel = async () => {
    try {
      const sourceList = getFilteredByDate();
      if (sourceList.length === 0) {
        Alert.alert('Ekspor Gagal', 'Tidak ada data transaksi untuk diekspor.');
        return;
      }

      const qrisList = sourceList.filter((tx) => isQrisMethod(tx.paymentMethod || ''));
      const transferList = sourceList.filter((tx) => isTransferMethod(tx.paymentMethod || ''));
      const cashList = sourceList.filter((tx) => !isQrisMethod(tx.paymentMethod || '') && !isTransferMethod(tx.paymentMethod || ''));

      const headers = [
        'No. Struk', 'Tanggal', 'Waktu', 'Kasir', 'Pelanggan', 'No. WhatsApp',
        'Metode Pembayaran', 'Bukti QRIS', 'Catatan',
        'Nama Menu', 'Jumlah (Qty)', 'Harga Satuan', 'Subtotal',
        'Total Belanja', 'Uang Bayar', 'Uang Kembali'
      ];

      const buildGroupRows = (txList: typeof sourceList, groupLabel: string) => {
        let rows = `"=== ${groupLabel} ===";;;;;;;;;;;;;;;\n`;
        rows += headers.join(';') + '\n';

        txList.forEach((tx) => {
          const dateTimeStr = formatDateTime(tx.date);
          const [dateVal, timeVal] = dateTimeStr.split(' ');
          const cleanNotes = tx.notes ? tx.notes.replace(/[\n\r;]/g, ' ') : '';
          const cleanCustomerName = tx.customerName ? tx.customerName.replace(/[\n\r;]/g, ' ') : '';
          const cleanCashierName = tx.cashierName ? tx.cashierName.replace(/[\n\r;]/g, ' ') : '';

          // Avoid dumping massive base64 strings into the CSV
          let cleanRef = '';
          if (tx.paymentRef) {
            try {
              const parsed = JSON.parse(tx.paymentRef);
              if (Array.isArray(parsed) && parsed[0] && parsed[0].startsWith('data:image')) {
                cleanRef = `[${parsed.length} Gambar Bukti Terlampir]`;
              } else {
                cleanRef = tx.paymentRef.replace(/[\n\r;]/g, ' ');
              }
            } catch {
              if (tx.paymentRef.startsWith('data:image')) {
                cleanRef = '[Gambar Bukti Terlampir]';
              } else {
                cleanRef = tx.paymentRef.replace(/[\n\r;]/g, ' ');
              }
            }
          }

          if (tx.items.length === 0) {
            rows += [
              tx.id, dateVal, timeVal,
              `"${cleanCashierName}"`, `"${cleanCustomerName}"`, `"${tx.customerPhone || ''}"`,
              `"${tx.paymentMethod}"`, `"${cleanRef}"`, `"${cleanNotes}"`,
              '', '', '', '', tx.total, tx.cashPaid, tx.change
            ].join(';') + '\n';
          } else {
            tx.items.forEach((item) => {
              const subtotal = item.price * item.quantity;
              const cleanName = item.name.replace(/[\n\r;]/g, ' ');
              rows += [
                tx.id, dateVal, timeVal,
                `"${cleanCashierName}"`, `"${cleanCustomerName}"`, `"${tx.customerPhone || ''}"`,
                `"${tx.paymentMethod}"`, `"${cleanRef}"`, `"${cleanNotes}"`,
                `"${cleanName}"`, item.quantity, item.price, subtotal,
                tx.total, tx.cashPaid, tx.change
              ].join(';') + '\n';
            });
          }
        });

        const groupTotal = txList.reduce((s, tx) => s + tx.total, 0);
        rows += [`"Jumlah Transaksi ${groupLabel}"`, '', '', '', '', '', '', '', '', '', '', '', txList.length, '', '', ''].join(';') + '\n';
        rows += [`"Total Pemasukan ${groupLabel}"`, '', '', '', '', '', '', '', '', '', '', '', groupTotal, '', '', ''].join(';') + '\n';
        return rows;
      };

      let csvContent = '';
      csvContent += buildGroupRows(qrisList, 'QRIS');
      csvContent += ';\n';
      csvContent += buildGroupRows(transferList, 'TRANSFER');
      csvContent += ';\n';
      csvContent += buildGroupRows(cashList, 'CASH (TUNAI)');
      csvContent += ';\n';

      const totalRevenue = sourceList.reduce((s, tx) => s + tx.total, 0);
      const qrisRevenue = qrisList.reduce((s, tx) => s + tx.total, 0);
      const transferRevenue = transferList.reduce((s, tx) => s + tx.total, 0);
      const cashRevenue = cashList.reduce((s, tx) => s + tx.total, 0);

      csvContent += '"=== RINGKASAN KESELURUHAN ===";;;;;;;;;;;;;;; \n';
      csvContent += ['"Total Transaksi"', '', '', '', '', '', '', '', '', '', '', '', sourceList.length, '', '', ''].join(';') + '\n';
      csvContent += ['"Total Pemasukan QRIS"', '', '', '', '', '', '', '', '', '', '', '', qrisRevenue, '', '', ''].join(';') + '\n';
      csvContent += ['"Total Pemasukan Transfer"', '', '', '', '', '', '', '', '', '', '', '', transferRevenue, '', '', ''].join(';') + '\n';
      csvContent += ['"Total Pemasukan Cash"', '', '', '', '', '', '', '', '', '', '', '', cashRevenue, '', '', ''].join(';') + '\n';
      csvContent += ['"TOTAL PEMASUKAN"', '', '', '', '', '', '', '', '', '', '', '', totalRevenue, '', '', ''].join(';') + '\n';

      const dateLabel = getDateLabel().replace(/[\/ ]/g, '_');
      const filename = `Laporan_${dateLabel}.csv`;
      const fileUri = `${FileSystem.documentDirectory}${filename}`;
      const bom = '\ufeff';
      await FileSystem.writeAsStringAsync(fileUri, bom + csvContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const isSharingAvailable = await Sharing.isAvailableAsync();
      if (isSharingAvailable) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: 'Bagikan Laporan Pembayaran',
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('Sharing Tidak Tersedia', `File tersimpan di: ${fileUri}`);
      }
    } catch (error) {
      console.error('Failed to export report:', error);
      Alert.alert('Gagal Ekspor', 'Terjadi kesalahan saat membuat laporan Excel.');
    }
  };


  const renderCalendarModal = () => {
    const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const DAY_HEADERS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
    const calendarDays: (number | null)[] = [];
    for (let i = 0; i < firstDayIndex; i++) calendarDays.push(null);
    for (let i = 1; i <= daysInMonth; i++) calendarDays.push(i);

    return (
      <Modal animationType="fade" transparent visible={calendarVisible} onRequestClose={() => setCalendarVisible(false)}>
        <View style={styles.modalOverlay}>
          <ThemedView type="backgroundElement" style={styles.calendarContainer}>
            <View style={styles.calendarHeader}>
              <Pressable
                onPress={() => {
                  if (calendarMonth === 0) { setCalendarMonth(11); setCalendarYear(y => y - 1); }
                  else setCalendarMonth(m => m - 1);
                }}
                style={styles.monthNavBtn}
              >
                <ThemedText style={styles.monthNavText}>{'<'}</ThemedText>
              </Pressable>
              <ThemedText type="smallBold" style={{ fontSize: 16 }}>{MONTH_NAMES[calendarMonth]} {calendarYear}</ThemedText>
              <Pressable
                onPress={() => {
                  if (calendarMonth === 11) { setCalendarMonth(0); setCalendarYear(y => y + 1); }
                  else setCalendarMonth(m => m + 1);
                }}
                style={styles.monthNavBtn}
              >
                <ThemedText style={styles.monthNavText}>{'>'}</ThemedText>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, borderBottomWidth: 1, borderColor: 'rgba(142,142,147,0.1)', paddingBottom: 4 }}>
              {DAY_HEADERS.map(d => (
                <View key={d} style={{ width: '14.28%', alignItems: 'center' }}>
                  <ThemedText type="code" themeColor="textSecondary" style={{ fontSize: 11, fontWeight: 'bold' }}>{d}</ThemedText>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: Spacing.three }}>
              {calendarDays.map((day, idx) => {
                if (day === null) return <View key={`e-${idx}`} style={styles.dayCell} />;
                const dayStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isSelected = activeTargetDate === dayStr;
                return (
                  <Pressable
                    key={`d-${day}`}
                    style={[styles.dayCell, isSelected && styles.dayCellActive]}
                    onPress={() => { setSelectedDate(dayStr); setCalendarVisible(false); }}
                  >
                    <ThemedText type="smallBold" style={[{ fontSize: 14 }, isSelected && { color: '#fff' }]}>{day}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
            <Pressable style={styles.closeCalendarBtn} onPress={() => setCalendarVisible(false)}>
              <ThemedText style={{ fontWeight: 'bold', fontSize: 14 }}>Batal</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>
    );
  };

  // ─── Detail Modal ─────────────────────────────────────────────────────────
  const renderDetailModal = () => {
    if (!detailTx) return null;
    const isQris = isQrisMethod(detailTx.paymentMethod || '');
    const isTransfer = isTransferMethod(detailTx.paymentMethod || '');
    const accentColor = isQris ? '#5E5CE6' : isTransfer ? '#007AFF' : '#FF9500';

    return (
      <Modal animationType="fade" transparent visible={!!detailTx} onRequestClose={() => setDetailTx(null)}>
        <View style={styles.modalOverlay}>
          <ThemedView type="backgroundElement" style={styles.detailModal}>
            <View style={[styles.detailHeader, { borderBottomColor: 'rgba(142,142,147,0.15)' }]}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold" style={{ fontSize: 17 }}>Detail Transaksi</ThemedText>
                <ThemedText type="code" themeColor="textSecondary" style={{ fontSize: 12, marginTop: 2 }}>{detailTx.id}</ThemedText>
              </View>
              <Pressable onPress={() => setDetailTx(null)} style={styles.closeBtn}>
                <ThemedText style={{ fontSize: 20, fontWeight: 'bold' }}>x</ThemedText>
              </Pressable>
            </View>

            <ScrollView style={{ marginTop: Spacing.three }} showsVerticalScrollIndicator={false}>
              <View style={[styles.methodBadge, { backgroundColor: isQris ? 'rgba(94,92,230,0.12)' : isTransfer ? 'rgba(0,122,255,0.12)' : 'rgba(255,149,0,0.12)', alignSelf: 'flex-start', marginBottom: Spacing.three }]}>
                <ThemedText style={{ color: accentColor, fontWeight: '700', fontSize: 13 }}>
                  {isQris ? '💳' : isTransfer ? '🏦' : '💵'} {detailTx.paymentMethod}
                </ThemedText>
              </View>

              <InfoRow label="Tanggal" value={formatDateTime(detailTx.date)} />
              {detailTx.customerName && <InfoRow label="Pelanggan" value={detailTx.customerName} />}
              {detailTx.cashierName && <InfoRow label="Kasir" value={detailTx.cashierName} />}
              {detailTx.orderType && <InfoRow label="Tipe Order" value={detailTx.orderType} />}
              {detailTx.notes && <InfoRow label="Catatan" value={detailTx.notes} />}

              <View style={[styles.refBox, { backgroundColor: isQris ? 'rgba(94,92,230,0.08)' : isTransfer ? 'rgba(0,122,255,0.08)' : 'rgba(255,149,0,0.08)', borderColor: accentColor + '40' }]}>
                <ThemedText type="small" style={{ color: accentColor, fontWeight: '600', fontSize: 12, marginBottom: 4 }}>
                  🔖 Bukti Pembayaran
                </ThemedText>
                {loadingRef ? (
                  <ThemedText type="small" themeColor="textSecondary">Memuat bukti...</ThemedText>
                  ) : detailTx.paymentRef ? (
                    (() => {
                      let refs: string[] = [];
                      try {
                        const parsed = JSON.parse(detailTx.paymentRef);
                        if (Array.isArray(parsed)) refs = parsed;
                        else refs = [detailTx.paymentRef];
                      } catch {
                        refs = [detailTx.paymentRef];
                      }
                      
                      const isImage = refs[0] && refs[0].startsWith('data:image');
                      if (isImage) {
                        return (
                          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ width: '100%', marginTop: 8 }}>
                            {refs.map((uri, idx) => (
                              <View key={idx} style={{ width: 280, paddingRight: refs.length > 1 ? 8 : 0 }}>
                                <Image
                                  source={{ uri }}
                                  style={{ width: '100%', height: 240, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.05)' }}
                                  resizeMode="contain"
                                />
                                {refs.length > 1 && (
                                  <ThemedText type="smallBold" style={{ textAlign: 'center', marginTop: 8, color: '#8E8E93' }}>
                                    Bukti {idx + 1} dari {refs.length}
                                  </ThemedText>
                                )}
                              </View>
                            ))}
                          </ScrollView>
                        );
                      } else {
                        return <ThemedText style={{ color: accentColor, fontWeight: '700', letterSpacing: 0.5 }}>{detailTx.paymentRef}</ThemedText>;
                      }
                    })()
                  ) : (
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                    🔖 Bukti belum diunggah
                  </ThemedText>
                )}
              </View>
              <View style={styles.divider} />

              {detailTx.items.map((item) => (
                <View key={item.dbId || item.id} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold" style={{ fontSize: 14 }}>{item.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{item.quantity}x {formatRupiah(item.price)}</ThemedText>
                  </View>
                  <ThemedText type="smallBold">{formatRupiah(item.price * item.quantity)}</ThemedText>
                </View>
              ))}

              <View style={styles.divider} />

              <View style={styles.summaryRowItem}>
                <ThemedText type="small">Total Tagihan</ThemedText>
                <ThemedText type="smallBold" style={{ color: accentColor }}>{formatRupiah(detailTx.total)}</ThemedText>
              </View>
              {detailTx.paymentMethod === 'Tunai' && (
                <>
                  <View style={styles.summaryRowItem}>
                    <ThemedText type="small">Uang Bayar</ThemedText>
                    <ThemedText type="small">{formatRupiah(detailTx.cashPaid)}</ThemedText>
                  </View>
                  <View style={styles.summaryRowItem}>
                    <ThemedText type="small" style={{ color: '#34C759' }}>Kembalian</ThemedText>
                    <ThemedText type="smallBold" style={{ color: '#34C759' }}>{formatRupiah(detailTx.change)}</ThemedText>
                  </View>
                </>
              )}
              <View style={{ height: Spacing.four }} />
            </ScrollView>
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
            <ThemedText type="subtitle" style={{ fontSize: 24, fontWeight: 'bold' }}>
              Laporan Pembayaran
            </ThemedText>
            <ThemedText type="code" themeColor="textSecondary" style={{ marginTop: 2 }}>
              {getDateLabel()}
            </ThemedText>
          </View>
          <Pressable style={styles.exportBtn} onPress={handleExportExcel}>
            <ThemedText style={styles.exportBtnText}>📊 Ekspor Excel</ThemedText>
          </Pressable>
        </ThemedView>

        {/* Date Filter Chips */}
        <View style={styles.filterSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, alignItems: 'center' }}>
            {(['today', 'yesterday'] as const).map((key) => {
              const label = key === 'today' ? 'Hari Ini' : 'Kemarin';
              const active = selectedDate === key;
              return (
                <Pressable
                  key={key}
                  style={[styles.filterChip, { backgroundColor: theme.backgroundElement }, active && styles.filterChipActive]}
                  onPress={() => setSelectedDate(key)}
                >
                  <ThemedText type="smallBold" style={{ color: active ? '#fff' : theme.text }}>{label}</ThemedText>
                </Pressable>
              );
            })}
            <Pressable
              style={[
                styles.filterChip,
                { backgroundColor: theme.backgroundElement },
                selectedDate !== 'today' && selectedDate !== 'yesterday' && styles.filterChipActive,
              ]}
              onPress={() => setCalendarVisible(true)}
            >
              <ThemedText type="smallBold" style={{
                color: selectedDate !== 'today' && selectedDate !== 'yesterday' ? '#fff' : theme.text,
              }}>
                {selectedDate !== 'today' && selectedDate !== 'yesterday'
                  ? `📅 ${getDateLabel()}`
                  : 'Pilih Tanggal... 📅'}
              </ThemedText>
            </Pressable>
          </ScrollView>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <TextInput
            style={[styles.searchInput, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: 'rgba(142,142,147,0.2)' }]}
            placeholder="🔍 Cari no. struk, nama, atau no. ref..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery ? (
            <Pressable style={styles.clearSearchBtn} onPress={() => setSearchQuery('')}>
              <ThemedText style={{ color: theme.textSecondary, fontSize: 18, fontWeight: 'bold', lineHeight: 20 }}>x</ThemedText>
            </Pressable>
          ) : null}
        </View>

        {/* Summary Cards */}
        <View style={styles.summaryCardsRow}>
          <View style={[styles.summaryCard, { borderTopColor: '#5E5CE6' }]}>
            <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>💳 Total QRIS</ThemedText>
            <ThemedText type="smallBold" style={{ color: '#5E5CE6', fontSize: 16, marginVertical: 2 }}>{formatRupiah(qrisTotal)}</ThemedText>
            <ThemedText type="code" themeColor="textSecondary" style={{ fontSize: 11 }}>{qrisTxs.length} trx</ThemedText>
          </View>
          <View style={[styles.summaryCard, { borderTopColor: '#007AFF' }]}>
            <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>🏦 Total Transfer</ThemedText>
            <ThemedText type="smallBold" style={{ color: '#007AFF', fontSize: 16, marginVertical: 2 }}>{formatRupiah(transferTotal)}</ThemedText>
            <ThemedText type="code" themeColor="textSecondary" style={{ fontSize: 11 }}>{transferTxs.length} trx</ThemedText>
          </View>
          <View style={[styles.summaryCard, { borderTopColor: '#FF9500' }]}>
            <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11 }}>💵 Total Cash</ThemedText>
            <ThemedText type="smallBold" style={{ color: '#FF9500', fontSize: 16, marginVertical: 2 }}>{formatRupiah(cashTotal)}</ThemedText>
            <ThemedText type="code" themeColor="textSecondary" style={{ fontSize: 11 }}>{cashTxs.length} trx</ThemedText>
          </View>
        </View>

        {/* Group Tabs */}
        <View style={[styles.groupTabRow, { backgroundColor: theme.backgroundElement }]}>
          <Pressable
            style={[styles.groupTab, activeGroup === 'qris' && styles.groupTabActiveQris]}
            onPress={() => setActiveGroup('qris')}
          >
            <ThemedText type="smallBold" style={{ color: activeGroup === 'qris' ? '#5E5CE6' : theme.textSecondary, fontSize: 14 }}>
              💳 QRIS ({qrisTxs.length})
            </ThemedText>
          </Pressable>
          <Pressable
            style={[styles.groupTab, activeGroup === 'transfer' && styles.groupTabActiveTransfer]}
            onPress={() => setActiveGroup('transfer')}
          >
            <ThemedText type="smallBold" style={{ color: activeGroup === 'transfer' ? '#007AFF' : theme.textSecondary, fontSize: 14 }}>
              🏦 Trans ({transferTxs.length})
            </ThemedText>
          </Pressable>
          <Pressable
            style={[styles.groupTab, activeGroup === 'cash' && styles.groupTabActiveCash]}
            onPress={() => setActiveGroup('cash')}
          >
            <ThemedText type="smallBold" style={{ color: activeGroup === 'cash' ? '#FF9500' : theme.textSecondary, fontSize: 14 }}>
              💵 Cash ({cashTxs.length})
            </ThemedText>
          </Pressable>
        </View>

        {/* Transaction List */}
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {activeTxs.length === 0 ? (
            <ThemedView style={styles.emptyContainer}>
              <ThemedText themeColor="textSecondary" style={{ fontSize: 15 }}>
                {activeGroup === 'qris' ? '💳' : activeGroup === 'transfer' ? '🏦' : '💵'} Tidak ada transaksi untuk tanggal ini.
              </ThemedText>
            </ThemedView>
          ) : (
            activeTxs.map((tx) => {
              const accentColor = activeGroup === 'qris' ? '#5E5CE6' : activeGroup === 'transfer' ? '#007AFF' : '#FF9500';
              return (
                <Pressable
                  key={tx.id}
                  onPress={() => handleOpenDetail(tx)}
                  style={({ pressed }) => [styles.txCard, pressed && { opacity: 0.8 }]}
                >
                  <ThemedView type="backgroundElement" style={[styles.txCardInner, { borderLeftWidth: 3, borderLeftColor: accentColor }]}>
                    <View style={styles.txCardTop}>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="smallBold" style={{ fontSize: 14 }}>{tx.id}</ThemedText>
                        <ThemedText type="code" themeColor="textSecondary" style={{ fontSize: 11, marginTop: 2 }}>
                          {formatDateTime(tx.date)}
                        </ThemedText>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <ThemedText type="smallBold" style={{ color: accentColor, fontSize: 15 }}>
                          {formatRupiah(tx.total)}
                        </ThemedText>
                        <View style={[styles.methodBadge, { backgroundColor: accentColor + '10', marginTop: 4 }]}>
                          <ThemedText style={{ color: accentColor, fontSize: 10, fontWeight: '700' }}>{tx.paymentMethod}</ThemedText>
                        </View>
                      </View>
                    </View>

                    {tx.customerName && (
                      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12, marginTop: 4 }}>
                        👤 {tx.customerName}
                      </ThemedText>
                    )}

                    {(activeGroup === 'qris' || activeGroup === 'transfer') ? (
                      <View style={[styles.refRow, { backgroundColor: accentColor + '08', borderColor: accentColor + '30' }]}>
                        <ThemedText style={{ color: accentColor, fontSize: 12, fontWeight: '600' }}>🔖 Bukti: </ThemedText>
                        <ThemedText style={{ color: accentColor, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>
                          Cek Detail 🖼️
                        </ThemedText>
                      </View>
                    ) : null}

                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={{ fontSize: 12, marginTop: 6 }}>
                      {tx.items.map(i => `${i.name}(${i.quantity})`).join(', ')}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        {renderCalendarModal()}
        {renderDetailModal()}
      </SafeAreaView>
    </ThemedView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.two }}>
      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 13 }}>{label}</ThemedText>
      <ThemedText type="small" style={{ fontSize: 13, fontWeight: '600', maxWidth: '60%', textAlign: 'right' }}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', flexDirection: 'row' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  filterSection: {
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.three,
  },
  filterChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: 'rgba(142,142,147,0.2)',
  },
  filterChipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
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
    backgroundColor: 'rgba(142,142,147,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCardsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  summaryCard: {
    flex: 1,
    padding: Spacing.two,
    borderRadius: Spacing.two,
    borderTopWidth: 3,
    backgroundColor: 'rgba(142,142,147,0.07)',
    gap: 2,
  },
  groupTabRow: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    marginBottom: Spacing.three,
    overflow: 'hidden',
  },
  groupTab: {
    flex: 1,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupTabActiveQris: {
    backgroundColor: 'rgba(94,92,230,0.12)',
    borderBottomWidth: 2,
    borderBottomColor: '#5E5CE6',
  },
  groupTabActiveTransfer: {
    backgroundColor: 'rgba(0,122,255,0.12)',
    borderBottomWidth: 2,
    borderBottomColor: '#007AFF',
  },
  groupTabActiveCash: {
    backgroundColor: 'rgba(255,149,0,0.12)',
    borderBottomWidth: 2,
    borderBottomColor: '#FF9500',
  },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.two,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
  },
  txCard: { borderRadius: Spacing.three, overflow: 'hidden' },
  txCardInner: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: 2,
  },
  txCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 2,
  },
  methodBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
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
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  monthNavBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(142,142,147,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  monthNavText: { fontSize: 18, fontWeight: 'bold' },
  dayCell: {
    width: '14.28%', height: 38,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 19, marginVertical: 2,
  },
  dayCellActive: { backgroundColor: '#007AFF' },
  closeCalendarBtn: {
    height: 44, borderRadius: Spacing.two,
    backgroundColor: 'rgba(142,142,147,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  detailModal: {
    width: '100%', maxWidth: 440,
    maxHeight: '90%',
    borderRadius: Spacing.four,
    padding: Spacing.four,
    elevation: 10,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingBottom: Spacing.two,
    borderBottomWidth: 1,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(142,142,147,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  refBox: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    marginBottom: Spacing.two,
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
  summaryRowItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: Spacing.half,
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
});
