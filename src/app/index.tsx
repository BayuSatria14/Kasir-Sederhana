import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Modal,
  Alert,
  Platform,
  View,
  useWindowDimensions,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Print from 'expo-print';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  CartItem,
  Transaction,
  formatRupiah,
  formatWhatsAppReceipt,
  generateHTMLReceipt,
  generateReceiptId,
} from '@/utils/receipt';
import { Product } from './products';
import { supabase } from '@/utils/supabase';

const DEFAULT_PRODUCTS: Product[] = [
  // Makanan
  { id: 'p1', name: 'Paket Iga Bakar', price: 45000, category: 'Makanan', stock: 999 },
  { id: 'p2', name: 'Paket Ayam Bakar', price: 35000, category: 'Makanan', stock: 999 },
  { id: 'p3', name: 'Paket Sate Babi', price: 40000, category: 'Makanan', stock: 999 },
  { id: 'p4', name: 'Nasi Goreng Samcan', price: 35000, category: 'Makanan', stock: 999 },
  { id: 'p5', name: 'Nasi Goreng Babi Special', price: 30000, category: 'Makanan', stock: 999 },
  { id: 'p6', name: 'Nasi Goreng Babi', price: 25000, category: 'Makanan', stock: 999 },
  { id: 'p7', name: 'Bakso Iga Babi', price: 30000, category: 'Makanan', stock: 999 },
  { id: 'p8', name: 'Bakso Babi', price: 25000, category: 'Makanan', stock: 999 },
  // Minuman
  { id: 'p9', name: 'Es Kelapa Muda', price: 15000, category: 'Minuman', stock: 999 },
  { id: 'p10', name: 'Es Tebu', price: 10000, category: 'Minuman', stock: 999 },
  { id: 'p11', name: 'Es Jeruk', price: 8000, category: 'Minuman', stock: 999 },
  { id: 'p12', name: 'Es Gula', price: 5000, category: 'Minuman', stock: 999 },
  { id: 'p13', name: 'Es Teh', price: 5000, category: 'Minuman', stock: 999 },
  // Gorengan
  { id: 'p14', name: 'Ketupat', price: 5000, category: 'Gorengan', stock: 999 },
  { id: 'p15', name: 'Kentang Goreng', price: 15000, category: 'Gorengan', stock: 999 },
  { id: 'p16', name: 'Nasi Putih', price: 5000, category: 'Gorengan', stock: 999 },
];

export default function KasirScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 768;

  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua');

  // Cashier and Shop settings states
  const [cashiers, setCashiers] = useState<string[]>([]);
  const [selectedCashier, setSelectedCashier] = useState('');
  const [shopName, setShopName] = useState('IGA BABI MELTIQ');

  // Checkout states
  const [checkoutModalVisible, setCheckoutModalVisible] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [cashPaid, setCashPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Tunai' | 'Transfer' | 'QRIS Gopay' | 'QRIS BPD'>('Tunai');
  const [notes, setNotes] = useState('');
  
  // Post-transaction modal
  const [receiptModalVisible, setReceiptModalVisible] = useState(false);
  const [completedTransaction, setCompletedTransaction] = useState<Transaction | null>(null);

  // Mobile cart overlay state
  const [mobileCartVisible, setMobileCartVisible] = useState(false);

  const loadProducts = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('products').select('*').order('name');
      if (error) throw error;
      if (data && data.length > 0) {
        setProducts(data);
      } else {
        // First time load: insert default products
        const { error: insertError } = await supabase.from('products').insert(DEFAULT_PRODUCTS);
        if (!insertError) {
          setProducts(DEFAULT_PRODUCTS);
        } else {
          console.error('Failed to insert default products', insertError);
          setProducts(DEFAULT_PRODUCTS);
        }
      }
    } catch (e) {
      console.error('Error loading products from Supabase:', e);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('settings').select('*');
      if (error) throw error;

      let shop = 'IGA BABI MELTIQ';
      let cashierList: string[] = [];
      let defCashier = '';

      if (data) {
        const shopRow = data.find(r => r.key === 'shop_name');
        if (shopRow) shop = shopRow.value;

        const cashiersRow = data.find(r => r.key === 'cashiers');
        if (cashiersRow) cashierList = cashiersRow.value || [];

        const defCashierRow = data.find(r => r.key === 'default_cashier');
        if (defCashierRow) defCashier = defCashierRow.value;
      }

      setShopName(shop);
      setCashiers(cashierList);

      if (defCashier && cashierList.includes(defCashier)) {
        setSelectedCashier(defCashier);
      } else if (cashierList.length > 0) {
        setSelectedCashier(cashierList[0]);
      } else {
        setSelectedCashier('');
      }
    } catch (e) {
      console.error('Error loading settings from Supabase:', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProducts();
      loadSettings();
    }, [loadProducts, loadSettings])
  );

  // Realtime subscriptions: auto-sync across devices
  useEffect(() => {
    const channel = supabase
      .channel('kasir-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        loadProducts();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => {
        loadSettings();
      })
      .subscribe((status, err) => {
        console.log('Realtime (index.tsx) Status:', status, err ? err : '');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadProducts, loadSettings]);

  // Cart operations
  const addToCart = (product: Product) => {
    const existing = cart.find((item) => item.id === product.id);
    if (existing) {
      setCart(
        cart.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      );
    } else {
      setCart([...cart, { id: product.id, name: product.name, price: product.price, quantity: 1 }]);
    }
  };

  const removeFromCart = (productId: string) => {
    const existing = cart.find((item) => item.id === productId);
    if (existing && existing.quantity > 1) {
      setCart(
        cart.map((item) =>
          item.id === productId ? { ...item, quantity: item.quantity - 1 } : item
        )
      );
    } else {
      setCart(cart.filter((item) => item.id !== productId));
    }
  };

  const deleteFromCart = (productId: string) => {
    setCart(cart.filter((item) => item.id !== productId));
  };

  const getCartTotal = () => {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  };

  const getCartCount = () => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  };

  const handleCheckoutOpen = () => {
    if (cart.length === 0) {
      Alert.alert('Keranjang Kosong', 'Silakan pilih produk terlebih dahulu');
      return;
    }
    setCashPaid('');
    setPaymentMethod('Tunai');
    setNotes('');
    // Automatically set default cashier or first cashier if available
    const resetCheckoutSelectedCashier = async () => {
      try {
        const { data, error } = await supabase.from('settings').select('*').eq('key', 'default_cashier').maybeSingle();
        const storedDefault = data ? data.value : null;
        if (storedDefault && cashiers.includes(storedDefault)) {
          setSelectedCashier(storedDefault);
        } else if (cashiers.length > 0) {
          setSelectedCashier(cashiers[0]);
        } else {
          setSelectedCashier('');
        }
      } catch (e) {
        console.error(e);
      }
    };
    resetCheckoutSelectedCashier();
    setCheckoutModalVisible(true);
  };

  const handleProcessCheckout = async () => {
    const total = getCartTotal();
    const paid = paymentMethod === 'Tunai' ? parseFloat(cashPaid) : total;
    
    if (isNaN(paid) || paid < total) {
      Alert.alert('Pembayaran Kurang', 'Jumlah uang bayar kurang dari total belanja');
      return;
    }

    const change = paymentMethod === 'Tunai' ? paid - total : 0;
    const transaction: Transaction = {
      id: generateReceiptId(),
      date: new Date().toISOString(),
      items: cart.map(item => ({ ...item, completed: false })),
      total,
      cashPaid: paid,
      change,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      cashierName: selectedCashier || undefined,
      paymentMethod,
      notes: notes.trim() || undefined,
      status: 'pending',
    };

    // Save transaction to Supabase
    try {
      const { error: txError } = await supabase.from('transactions').insert([{
        id: transaction.id,
        date: transaction.date,
        total: transaction.total,
        cash_paid: transaction.cashPaid,
        change: transaction.change,
        customer_name: transaction.customerName || null,
        customer_phone: transaction.customerPhone || null,
        cashier_name: transaction.cashierName || null,
        payment_method: transaction.paymentMethod,
        notes: transaction.notes || null,
        status: transaction.status,
      }]);
      if (txError) throw txError;

      // Save transaction items
      const { error: itemsError } = await supabase.from('transaction_items').insert(
        cart.map(item => ({
          transaction_id: transaction.id,
          product_id: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          completed: false,
        }))
      );
      if (itemsError) throw itemsError;

      // Deduct stocks
      for (const item of cart) {
        const prod = products.find(p => p.id === item.id);
        if (prod) {
          const newStock = Math.max(0, prod.stock - item.quantity);
          await supabase.from('products').update({ stock: newStock }).eq('id', prod.id);
        }
      }

      // Reload products list from Supabase
      const { data: updatedProducts } = await supabase.from('products').select('*').order('name');
      if (updatedProducts) setProducts(updatedProducts);

    } catch (e: any) {
      console.error('Failed to save transaction to Supabase', e);
      Alert.alert('Error Database', 'Gagal menyimpan transaksi ke database online.');
      return;
    }

    setCompletedTransaction(transaction);
    setCheckoutModalVisible(false);
    setMobileCartVisible(false);
    setReceiptModalVisible(true);
  };

  const resetCart = () => {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setCashPaid('');
    setNotes('');
    setPaymentMethod('Tunai');
    setReceiptModalVisible(false);
  };

  const handlePrint = async () => {
    if (!completedTransaction) return;
    try {
      const html = generateHTMLReceipt(completedTransaction, shopName);
      await Print.printAsync({ html });
    } catch {
      Alert.alert('Error', 'Gagal mencetak struk');
    }
  };

  const handleWhatsApp = () => {
    if (!completedTransaction) return;
    const phone = completedTransaction.customerPhone || '';
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    
    // Add Indonesian country code if phone starts with 0
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.slice(1);
    }

    const text = formatWhatsAppReceipt(completedTransaction, shopName);
    const url = `https://wa.me/${cleanPhone}?text=${text}`;

    Linking.openURL(url).catch((err) => {
      Alert.alert('Error', 'Gagal membuka WhatsApp. Pastikan aplikasi WhatsApp terinstal.');
    });
  };

  // Filter Catalog
  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === 'Semua' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ['Semua', 'Makanan', 'Minuman', 'Gorengan'];

  const renderCatalog = () => (
    <View style={styles.catalogContainer}>
      {/* Search & Filter */}
      <View style={styles.filterSection}>
        <TextInput
          style={[
            styles.searchInput,
            {
              backgroundColor: theme.backgroundElement,
              color: theme.text,
              borderColor: theme.backgroundSelected,
            },
          ]}
          placeholder="Cari produk..."
          placeholderTextColor={theme.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryContainer}
        >
          {categories.map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <Pressable
                key={cat}
                style={[
                  styles.categoryBtn,
                  {
                    backgroundColor: isSelected
                      ? theme.text
                      : theme.backgroundElement,
                  },
                ]}
                onPress={() => setSelectedCategory(cat)}
              >
                <ThemedText
                  type="smallBold"
                  style={{
                    color: isSelected ? theme.background : theme.text,
                  }}
                >
                  {cat}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Catalog items */}
      <ScrollView contentContainerStyle={styles.catalogScrollContent}>
        {filteredProducts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <ThemedText themeColor="textSecondary">
              Tidak ada produk tersedia.
            </ThemedText>
          </View>
        ) : (
          <View style={styles.catalogGrid}>
            {filteredProducts.map((p) => {
              const inCart = cart.find((item) => item.id === p.id);
              const isOutOfStock = p.stock <= 0;

              return (
                <Pressable
                  key={p.id}
                  style={[
                    styles.productCard,
                    { backgroundColor: theme.backgroundElement },
                    isOutOfStock && styles.disabledCard,
                  ]}
                  onPress={() => !isOutOfStock && addToCart(p)}
                  disabled={isOutOfStock}
                >
                  <View
                    style={[
                      styles.cardHeader,
                      {
                        backgroundColor:
                          p.category === 'Makanan'
                            ? '#FF9500'
                            : p.category === 'Minuman'
                            ? '#007AFF'
                            : '#8E8E93',
                      },
                    ]}
                  >
                    <ThemedText type="smallBold" style={styles.cardCategory}>
                      {p.name[0].toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={styles.cardBody}>
                    <ThemedText type="smallBold" numberOfLines={2} style={styles.productName}>
                      {p.name}
                    </ThemedText>
                    <ThemedText type="smallBold" style={styles.productPrice}>
                      {formatRupiah(p.price)}
                    </ThemedText>
                    <View style={styles.productFooter}>
                      <ThemedText type="code" style={styles.stockText} themeColor="textSecondary">
                        Stok: {p.stock}
                      </ThemedText>
                      {inCart && (
                        <View style={styles.cardCartControls}>
                          <Pressable
                            style={styles.cardMinusBtn}
                            onPress={(e) => {
                              if (Platform.OS === 'web') {
                                e.stopPropagation();
                              }
                              removeFromCart(p.id);
                            }}
                          >
                            <ThemedText style={styles.cardMinusBtnText}>-</ThemedText>
                          </Pressable>
                          <View style={styles.quantityBadge}>
                            <ThemedText type="smallBold" style={styles.quantityBadgeText}>
                              {inCart.quantity}
                            </ThemedText>
                          </View>
                        </View>
                      )}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );

  const renderCartItems = () => (
    <ScrollView style={styles.cartItemsScroll} contentContainerStyle={styles.cartItemsContainer}>
      {cart.length === 0 ? (
        <View style={styles.emptyCartContainer}>
          <ThemedText themeColor="textSecondary">Keranjang masih kosong.</ThemedText>
        </View>
      ) : (
        cart.map((item) => (
          <ThemedView key={item.id} style={styles.cartCard} type="backgroundSelected">
            <View style={styles.cartCardLeft}>
              <ThemedText type="smallBold">{item.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatRupiah(item.price)} x {item.quantity}
              </ThemedText>
            </View>
            <View style={styles.cartCardRight}>
              <ThemedText type="smallBold" style={styles.cartSubtotal}>
                {formatRupiah(item.price * item.quantity)}
              </ThemedText>
              <View style={styles.cartControls}>
                <Pressable
                  style={styles.cartBtn}
                  onPress={() => removeFromCart(item.id)}
                >
                  <ThemedText style={styles.cartBtnText}>-</ThemedText>
                </Pressable>
                <Pressable style={styles.cartBtn} onPress={() => addToCart(item as any)}>
                  <ThemedText style={styles.cartBtnText}>+</ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.cartBtn, styles.deleteCartBtn]}
                  onPress={() => deleteFromCart(item.id)}
                >
                  <ThemedText style={[styles.cartBtnText, { color: '#ffffff' }]}>×</ThemedText>
                </Pressable>
              </View>
            </View>
          </ThemedView>
        ))
      )}
    </ScrollView>
  );

  const renderCartPanel = () => (
    <ThemedView type="backgroundElement" style={styles.cartPanel}>
      <View style={styles.cartHeader}>
        <ThemedText type="smallBold" style={styles.cartTitle}>
          Keranjang Belanja
        </ThemedText>
        {cart.length > 0 && (
          <Pressable onPress={() => setCart([])}>
            <ThemedText type="small" style={{ color: '#FF3B30' }}>
              Kosongkan
            </ThemedText>
          </Pressable>
        )}
      </View>

      {renderCartItems()}

      <View style={styles.cartFooter}>
        <View style={styles.totalRow}>
          <ThemedText type="default" style={styles.totalLabel}>
            Total
          </ThemedText>
          <ThemedText type="subtitle" style={styles.totalVal}>
            {formatRupiah(getCartTotal())}
          </ThemedText>
        </View>
        <Pressable
          style={[styles.checkoutBtn, cart.length === 0 && styles.disabledBtn]}
          onPress={handleCheckoutOpen}
          disabled={cart.length === 0}
        >
          <ThemedText style={styles.checkoutBtnText}>Proses Bayar</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Main Content Area */}
        <View style={styles.mainLayout}>
          {renderCatalog()}

          {/* Cart Panel (for wide screens) */}
          {isLargeScreen && renderCartPanel()}
        </View>

        {/* Floating Cart Button for Mobile Screens */}
        {!isLargeScreen && cart.length > 0 && (
          <Pressable
            style={styles.floatingCart}
            onPress={() => setMobileCartVisible(true)}
          >
            <View style={styles.floatingCartLeft}>
              <View style={styles.floatingCount}>
                <ThemedText style={styles.floatingCountText}>{getCartCount()}</ThemedText>
              </View>
              <ThemedText style={styles.floatingCartText}>Lihat Keranjang</ThemedText>
            </View>
            <ThemedText style={styles.floatingCartTotal}>
              {formatRupiah(getCartTotal())}
            </ThemedText>
          </Pressable>
        )}

        {/* Mobile Cart Sheet/Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={mobileCartVisible}
          onRequestClose={() => setMobileCartVisible(false)}
        >
          <View style={styles.bottomSheetOverlay}>
            <ThemedView type="backgroundElement" style={styles.bottomSheetContainer}>
              <View style={styles.bottomSheetHeader}>
                <ThemedText type="smallBold" style={{ fontSize: 18 }}>
                  Keranjang ({getCartCount()} item)
                </ThemedText>
                <Pressable
                  style={styles.closeSheetBtn}
                  onPress={() => setMobileCartVisible(false)}
                >
                  <ThemedText style={{ fontSize: 20 }}>×</ThemedText>
                </Pressable>
              </View>
              
              <View style={{ flex: 1 }}>{renderCartItems()}</View>

              <View style={[styles.cartFooter, { paddingBottom: Spacing.four }]}>
                <View style={styles.totalRow}>
                  <ThemedText type="default">Total</ThemedText>
                  <ThemedText type="subtitle">{formatRupiah(getCartTotal())}</ThemedText>
                </View>
                <Pressable style={styles.checkoutBtn} onPress={handleCheckoutOpen}>
                  <ThemedText style={styles.checkoutBtnText}>Proses Bayar</ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          </View>
        </Modal>

        {/* Checkout & Payment Input Modal */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={checkoutModalVisible}
          onRequestClose={() => setCheckoutModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <ThemedView type="backgroundElement" style={styles.checkoutModalContent}>
              <ThemedText type="smallBold" style={styles.modalTitle}>
                Pembayaran
              </ThemedText>

              <ScrollView style={{ maxHeight: 350 }}>
                {/* Total tagihan */}
                <View style={styles.tagihanContainer}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Total Tagihan:
                  </ThemedText>
                  <ThemedText type="subtitle" style={styles.tagihanTotal}>
                    {formatRupiah(getCartTotal())}
                  </ThemedText>
                </View>

                {/* Metode Pembayaran */}
                <View style={styles.formGroup}>
                  <ThemedText type="small" style={styles.label}>
                    Pilih Metode Pembayaran
                  </ThemedText>
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
                            {
                              backgroundColor: isSelected
                                ? '#34C759'
                                : theme.backgroundSelected,
                            },
                          ]}
                          onPress={() => {
                            setPaymentMethod(method);
                            if (method !== 'Tunai') {
                              setCashPaid(String(getCartTotal()));
                            } else {
                              setCashPaid('');
                            }
                          }}
                        >
                          <ThemedText
                            type="smallBold"
                            style={{
                              color: isSelected ? '#ffffff' : theme.text,
                              fontSize: 13,
                            }}
                          >
                            {method}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {/* Form fields */}
                {paymentMethod === 'Tunai' ? (
                  <>
                    <View style={styles.formGroup}>
                      <ThemedText type="small" style={styles.label}>
                        Uang Tunai Bayar (Rupiah)
                      </ThemedText>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.background,
                            color: theme.text,
                            borderColor: theme.backgroundSelected,
                            fontSize: 18,
                            fontWeight: 'bold',
                          },
                        ]}
                        value={cashPaid}
                        onChangeText={setCashPaid}
                        placeholder="Contoh: 50000"
                        placeholderTextColor={theme.textSecondary}
                        keyboardType="numeric"
                        autoFocus
                      />
                    </View>

                    {/* Kembalian */}
                    {parseFloat(cashPaid) >= getCartTotal() && (
                      <View style={styles.kembalianBox}>
                        <ThemedText type="small" style={{ color: '#34C759' }}>
                          Kembalian:
                        </ThemedText>
                        <ThemedText type="smallBold" style={styles.kembalianVal}>
                          {formatRupiah(parseFloat(cashPaid) - getCartTotal())}
                        </ThemedText>
                      </View>
                    )}
                  </>
                ) : (
                  <View style={styles.nonCashTotalBox}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Pembayaran Elektronik / Transfer:
                    </ThemedText>
                    <ThemedText type="smallBold" style={{ color: '#34C759', fontSize: 16, marginTop: 4 }}>
                      {formatRupiah(getCartTotal())} (Lunas)
                    </ThemedText>
                  </View>
                )}

                {/* Pilih Kasir */}
                <View style={styles.formGroup}>
                  <ThemedText type="small" style={styles.label}>
                    Pilih Staff Kasir
                  </ThemedText>
                  {cashiers.length === 0 ? (
                    <ThemedText type="small" style={{ color: '#FF3B30', marginTop: 4 }}>
                      Belum ada kasir. Tambahkan nama kasir di tab Setelan.
                    </ThemedText>
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.cashierChipsScroll}
                    >
                      {cashiers.map((name) => {
                        const isSelected = selectedCashier === name;
                        return (
                          <Pressable
                            key={name}
                            style={[
                              styles.cashierChip,
                              {
                                backgroundColor: isSelected
                                  ? '#007AFF'
                                  : theme.backgroundSelected,
                              },
                            ]}
                            onPress={() => setSelectedCashier(name)}
                          >
                            <ThemedText
                              type="smallBold"
                              style={{
                                color: isSelected ? '#ffffff' : theme.text,
                                fontSize: 13,
                              }}
                            >
                              {name}
                            </ThemedText>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>

                <View style={styles.formGroup}>
                  <ThemedText type="small" style={styles.label}>
                    Nama Pelanggan *
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.background,
                        color: theme.text,
                        borderColor: theme.backgroundSelected,
                      },
                    ]}
                    value={customerName}
                    onChangeText={setCustomerName}
                    placeholder="Contoh: Pak Budi"
                    placeholderTextColor={theme.textSecondary}
                  />
                </View>

                <View style={styles.formGroup}>
                  <ThemedText type="small" style={styles.label}>
                    No. WhatsApp *
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.background,
                        color: theme.text,
                        borderColor: theme.backgroundSelected,
                      },
                    ]}
                    value={customerPhone}
                    onChangeText={setCustomerPhone}
                    placeholder="Contoh: 08123456789"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="phone-pad"
                  />
                </View>

                <View style={styles.formGroup}>
                  <ThemedText type="small" style={styles.label}>
                    Catatan Transaksi (Opsional)
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.background,
                        color: theme.text,
                        borderColor: theme.backgroundSelected,
                      },
                    ]}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Contoh: Tanpa sedotan, es dipisah"
                    placeholderTextColor={theme.textSecondary}
                  />
                </View>
              </ScrollView>

              <View style={styles.modalActions}>
                <Pressable
                  style={[styles.modalBtn, styles.cancelBtn]}
                  onPress={() => setCheckoutModalVisible(false)}
                >
                  <ThemedText style={styles.cancelBtnText}>Batal</ThemedText>
                </Pressable>
                <Pressable
                  style={[
                    styles.modalBtn,
                    styles.saveBtn,
                    (!cashPaid || parseFloat(cashPaid) < getCartTotal() || !customerName.trim() || !customerPhone.trim()) && styles.disabledBtn,
                  ]}
                  onPress={handleProcessCheckout}
                  disabled={!cashPaid || parseFloat(cashPaid) < getCartTotal() || !customerName.trim() || !customerPhone.trim()}
                >
                  <ThemedText style={styles.saveBtnText}>Bayar & Selesai</ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          </View>
        </Modal>

        {/* Post-Transaction Receipt Modal */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={receiptModalVisible}
          onRequestClose={resetCart}
        >
          <View style={styles.modalOverlay}>
            <ThemedView type="backgroundElement" style={styles.receiptModalContent}>
              <Pressable
                style={styles.absoluteCloseBtn}
                onPress={resetCart}
              >
                <ThemedText style={{ fontSize: 24, fontWeight: 'bold', lineHeight: 26 }}>×</ThemedText>
              </Pressable>

              <ThemedText type="smallBold" style={styles.modalTitle}>
                Transaksi Berhasil
              </ThemedText>

              {completedTransaction && (
                <ScrollView style={styles.receiptSummary}>
                  <ThemedText type="code" style={{ textAlign: 'center', marginBottom: Spacing.two }}>
                    No. Struk: {completedTransaction.id}
                  </ThemedText>
                  {completedTransaction.cashierName && (
                    <ThemedText type="code" style={{ textAlign: 'center', marginBottom: Spacing.two }}>
                      Kasir: {completedTransaction.cashierName}
                    </ThemedText>
                  )}
                  <View style={styles.divider} />
                  
                  {completedTransaction.items.map((item) => (
                    <View key={item.id} style={styles.receiptItem}>
                      <ThemedText type="small" style={{ flex: 1 }}>{item.name}</ThemedText>
                      <ThemedText type="small">
                        {item.quantity}x {formatRupiah(item.price)}
                      </ThemedText>
                    </View>
                  ))}

                  <View style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: theme.textSecondary, marginVertical: 8 }} />
                  
                  <View style={styles.receiptRow}>
                    <ThemedText type="smallBold">Total</ThemedText>
                    <ThemedText type="smallBold">{formatRupiah(completedTransaction.total)}</ThemedText>
                  </View>
                  <View style={styles.receiptRow}>
                    <ThemedText type="small">Bayar</ThemedText>
                    <ThemedText type="small">{formatRupiah(completedTransaction.cashPaid)}</ThemedText>
                  </View>
                  <View style={styles.receiptRow}>
                    <ThemedText type="smallBold" style={{ color: '#34C759' }}>Kembalian</ThemedText>
                    <ThemedText type="smallBold" style={{ color: '#34C759' }}>{formatRupiah(completedTransaction.change)}</ThemedText>
                  </View>
                  <View style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: theme.textSecondary, marginVertical: 8 }} />
                  <View style={styles.receiptRow}>
                    <ThemedText type="small">Metode Bayar</ThemedText>
                    <ThemedText type="smallBold">{completedTransaction.paymentMethod || 'Tunai'}</ThemedText>
                  </View>
                  {completedTransaction.notes && (
                    <View style={styles.receiptRow}>
                      <ThemedText type="small">Catatan</ThemedText>
                      <ThemedText type="small" style={{ fontStyle: 'italic' }}>{completedTransaction.notes}</ThemedText>
                    </View>
                  )}
                </ScrollView>
              )}

              {/* Action Buttons */}
              <View style={styles.receiptActions}>
                <Pressable style={[styles.receiptBtn, styles.printBtn]} onPress={handlePrint}>
                  <ThemedText style={styles.receiptBtnText}>🖨️ Cetak Struk</ThemedText>
                </Pressable>
                
                <Pressable
                  style={[
                    styles.receiptBtn,
                    styles.waBtn,
                    (!completedTransaction?.customerPhone) && styles.disabledReceiptBtn,
                  ]}
                  onPress={handleWhatsApp}
                  disabled={!completedTransaction?.customerPhone}
                >
                  <ThemedText style={styles.receiptBtnText}>💬 Kirim ke WA</ThemedText>
                </Pressable>
              </View>

              {!completedTransaction?.customerPhone && (
                <ThemedText type="code" style={styles.hintText} themeColor="textSecondary">
                  *Masukkan nomor WA pelanggan saat checkout untuk mengaktifkan opsi kirim WhatsApp.
                </ThemedText>
              )}

              <Pressable style={styles.doneBtn} onPress={resetCart}>
                <ThemedText style={styles.doneBtnText}>Transaksi Baru</ThemedText>
              </Pressable>
            </ThemedView>
          </View>
        </Modal>
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
    width: '100%',
  },
  mainLayout: {
    flex: 1,
    flexDirection: 'row',
  },
  catalogContainer: {
    flex: 1,
    paddingVertical: Spacing.two,
  },
  filterSection: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  searchInput: {
    height: 48,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
  },
  categoryContainer: {
    paddingVertical: Spacing.one,
    gap: Spacing.two,
  },
  categoryBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginRight: Spacing.one,
  },
  catalogScrollContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.six,
  },
  catalogGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
  },
  productCard: {
    width: Platform.OS === 'web' ? '23%' : '47%',
    minWidth: 140,
    borderRadius: Spacing.three,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  disabledCard: {
    opacity: 0.4,
  },
  cardHeader: {
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCategory: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: 'bold',
  },
  cardBody: {
    padding: Spacing.two,
    gap: Spacing.one,
  },
  productName: {
    fontSize: 14,
    height: 38,
  },
  productPrice: {
    fontSize: 15,
    color: '#34C759',
  },
  productFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  stockText: {
    fontSize: 10,
  },
  quantityBadge: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  quantityBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  cartPanel: {
    width: 320,
    borderLeftWidth: 1,
    borderColor: '#CCCCCC',
    padding: Spacing.three,
    display: 'flex',
  },
  cartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  cartTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  cartItemsScroll: {
    flex: 1,
  },
  cartItemsContainer: {
    gap: Spacing.two,
  },
  emptyCartContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
  },
  cartCard: {
    padding: Spacing.two,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  cartCardLeft: {
    flex: 1,
  },
  cartCardRight: {
    alignItems: 'flex-end',
    gap: Spacing.one,
  },
  cartSubtotal: {
    color: '#34C759',
    fontSize: 14,
  },
  cartControls: {
    flexDirection: 'row',
    gap: Spacing.one,
    alignItems: 'center',
  },
  cartBtn: {
    width: 26,
    height: 26,
    backgroundColor: '#8E8E93',
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteCartBtn: {
    backgroundColor: '#FF3B30',
  },
  cartBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
    lineHeight: 18,
  },
  cartFooter: {
    borderTopWidth: 1,
    borderColor: '#DDDDDD',
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontWeight: 'bold',
  },
  totalVal: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#34C759',
  },
  checkoutBtn: {
    backgroundColor: '#34C759',
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkoutBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  floatingCart: {
    position: 'absolute',
    bottom: BottomTabInset + Spacing.two,
    left: Spacing.three,
    right: Spacing.three,
    height: 56,
    backgroundColor: '#007AFF',
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  floatingCartLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  floatingCount: {
    backgroundColor: '#ffffff',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingCountText: {
    color: '#007AFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  floatingCartText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  floatingCartTotal: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  bottomSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  bottomSheetContainer: {
    height: '75%',
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    padding: Spacing.three,
    elevation: 10,
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.two,
    borderBottomWidth: 1,
    borderColor: '#EEEEEE',
    paddingBottom: Spacing.two,
  },
  closeSheetBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E5E5EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  checkoutModalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: Spacing.one,
  },
  tagihanContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    backgroundColor: 'rgba(0, 122, 255, 0.05)',
    borderRadius: Spacing.two,
    marginBottom: Spacing.two,
  },
  tagihanTotal: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#007AFF',
    marginTop: Spacing.half,
  },
  formGroup: {
    gap: Spacing.one,
    marginBottom: Spacing.two,
  },
  label: {
    fontWeight: 'bold',
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
  },
  kembalianBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.two,
    backgroundColor: 'rgba(52, 199, 89, 0.08)',
    borderRadius: Spacing.two,
    marginBottom: Spacing.two,
  },
  kembalianVal: {
    fontSize: 18,
    color: '#34C759',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  modalBtn: {
    flex: 1,
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#CCCCCC',
  },
  cancelBtnText: {
    color: '#888888',
    fontWeight: 'bold',
  },
  saveBtn: {
    backgroundColor: '#007AFF',
  },
  saveBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  disabledBtn: {
    backgroundColor: '#AEAEB2',
    opacity: 0.8,
  },
  receiptModalContent: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    alignItems: 'center',
    elevation: 5,
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
    maxHeight: 250,
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
  hintText: {
    fontSize: 10.5,
    textAlign: 'center',
    marginTop: Spacing.two,
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
  cashierChipsScroll: {
    paddingVertical: Spacing.one,
    gap: Spacing.two,
  },
  cashierChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginRight: Spacing.one,
  },
  paymentChipsScroll: {
    paddingVertical: Spacing.one,
    gap: Spacing.two,
  },
  paymentChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginRight: Spacing.one,
  },
  nonCashTotalBox: {
    padding: Spacing.two,
    backgroundColor: 'rgba(52, 199, 89, 0.08)',
    borderRadius: Spacing.two,
    marginBottom: Spacing.two,
  },
  cardCartControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardMinusBtn: {
    width: 24,
    height: 24,
    backgroundColor: '#FF3B30',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMinusBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
    lineHeight: 16,
  },
});
