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
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Print from 'expo-print';
import * as ImagePicker from 'expo-image-picker';

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

  // Order modal states
  const [orderModalVisible, setOrderModalVisible] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderType, setOrderType] = useState<'Dine In' | 'Takeaway'>('Dine In');
  const [notes, setNotes] = useState('');

  // Add-to-existing-order mode
  const [addToOrderId, setAddToOrderId] = useState<string | null>(null);
  const [addToOrderConfirmVisible, setAddToOrderConfirmVisible] = useState(false);
  const [allOrders, setAllOrders] = useState<Transaction[]>([]);
  const [selectOrderModalVisible, setSelectOrderModalVisible] = useState(false);
  const [selectOrderTab, setSelectOrderTab] = useState<'pending' | 'completed'>('pending');
  const [addPaymentStatus, setAddPaymentStatus] = useState<'paid' | 'unpaid'>('unpaid');
  const [addPaymentMethod, setAddPaymentMethod] = useState<'Tunai' | 'Transfer' | 'QRIS Gopay' | 'QRIS BPD'>('Tunai');
  const [addCashPaid, setAddCashPaid] = useState('');
  const [addPaymentRefs, setAddPaymentRefs] = useState<string[]>([]);

  // Post-order modal
  const [orderDoneModalVisible, setOrderDoneModalVisible] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [isAddToExisting, setIsAddToExisting] = useState(false);

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

  const loadAllOrders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select(`id, date, total, cash_paid, change, customer_name, customer_phone, cashier_name, payment_method, notes, status, order_type, payment_status, transaction_items (id, product_id, name, quantity, price, completed, payment_status)`)
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
          notes: tx.notes || undefined,
          status: tx.status || 'completed',
          orderType: tx.order_type || 'Dine In',
          paymentStatus: tx.payment_status || 'paid',
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
        setAllOrders(mapped);
      }
    } catch (e) {
      console.error('Error loading orders:', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProducts();
      loadSettings();
      loadAllOrders();
    }, [loadProducts, loadSettings, loadAllOrders])
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        loadAllOrders();
      })
      .subscribe((status, err) => {
        console.log('Realtime (index.tsx) Status:', status, err ? err : '');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadProducts, loadSettings, loadAllOrders]);

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

  const handleOrderOpen = () => {
    if (cart.length === 0) {
      Alert.alert('Keranjang Kosong', 'Silakan pilih produk terlebih dahulu');
      return;
    }
    setOrderType('Dine In');
    setNotes('');
    setCustomerName('');
    setCustomerPhone('');

    // Automatically set default cashier if available
    const resetCheckoutSelectedCashier = async () => {
      try {
        const { data } = await supabase.from('settings').select('*').eq('key', 'default_cashier').maybeSingle();
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
    setAddToOrderId(null);
    setOrderModalVisible(true);
  };

  // Open modal to select an existing order to add items to
  const handleOpenAddToOrder = () => {
    if (cart.length === 0) {
      Alert.alert('Keranjang Kosong', 'Silakan pilih produk terlebih dahulu');
      return;
    }
    if (allOrders.length === 0) {
      Alert.alert('Tidak Ada Order', 'Belum ada order. Buat order baru terlebih dahulu.');
      return;
    }
    setSelectOrderTab('pending');
    setSelectOrderModalVisible(true);
  };

  const handleSelectExistingOrder = (orderId: string) => {
    setAddToOrderId(orderId);
    setAddPaymentStatus('unpaid');
    setAddPaymentRefs([]);
    setSelectOrderModalVisible(false);
    setAddToOrderConfirmVisible(true);
  };

  const handlePickAddImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        allowsMultipleSelection: true,
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled) {
        const newImages = result.assets
          .filter(a => a.base64)
          .map(a => `data:image/jpeg;base64,${a.base64}`);
        setAddPaymentRefs(prev => [...prev, ...newImages]);
      }
    } catch (e) {
      Alert.alert('Gagal', 'Terjadi kesalahan saat memilih gambar.');
    }
  };


  // Add cart items to an existing order
  const handleAddItemsToExistingOrder = async () => {
    if (!addToOrderId) return;
    const targetOrder = allOrders.find(o => o.id === addToOrderId);
    if (!targetOrder) return;

    const addedTotal = getCartTotal();
    let paidForAddition = 0;
    let changeForAddition = 0;

    if (addPaymentStatus === 'paid') {
      if (addPaymentMethod === 'Tunai') {
        const cashInput = parseFloat(addCashPaid);
        if (isNaN(cashInput) || cashInput < addedTotal) {
          Alert.alert('Pembayaran Kurang', `Jumlah uang bayar kurang dari total tambahan ${formatRupiah(addedTotal)}.`);
          return;
        }
        paidForAddition = cashInput;
        changeForAddition = cashInput - addedTotal;
      } else {
        if (addPaymentRefs.length === 0) {
          Alert.alert('Gagal', 'Bukti pembayaran wajib diupload.');
          return;
        }
        paidForAddition = addedTotal;
        changeForAddition = 0;
      }
    }

    try {
      if ((targetOrder.paymentStatus || 'paid') === 'paid') {
        // Fix for legacy data: if the order was already paid, ensure its existing items
        // are explicitly marked as paid in the database before inserting new items.
        await supabase
          .from('transaction_items')
          .update({ payment_status: 'paid' })
          .eq('transaction_id', addToOrderId);
      }

      const newItems = cart.map(item => ({
        transaction_id: addToOrderId,
        product_id: item.id,
        name: item.note ? `${item.name} (${item.note})` : item.name,
        quantity: item.quantity,
        price: item.price,
        completed: false, // Pesanan belum disajikan, maka false
        payment_status: addPaymentStatus,
      }));

      const { error: itemsError } = await supabase.from('transaction_items').insert(newItems);
      if (itemsError) throw itemsError;

      // Recalculate total and payment
      const newTotal = targetOrder.total + addedTotal;
      const newCashPaid = targetOrder.cashPaid + paidForAddition;
      const newChange = targetOrder.change + changeForAddition;
      
      // Jika status tambahan adalah belum bayar, maka transaksi secara keseluruhan belum lunas
      const isFullyPaid = addPaymentStatus === 'unpaid' 
        ? false 
        : (newCashPaid - newChange >= newTotal);

      let updateData: any = {
        total: newTotal,
        cash_paid: newCashPaid,
        change: newChange,
        payment_status: isFullyPaid ? 'paid' : 'unpaid',
        status: 'pending',
      };

      if (addPaymentStatus === 'paid') {
        updateData.payment_method = addPaymentMethod;
        if (addPaymentMethod !== 'Tunai' && addPaymentRefs.length > 0) {
          let finalPaymentRefs = [...addPaymentRefs];
          try {
            const { data: existingTx } = await supabase.from('transactions').select('payment_ref').eq('id', addToOrderId).single();
            if (existingTx && existingTx.payment_ref) {
              try {
                const parsed = JSON.parse(existingTx.payment_ref);
                if (Array.isArray(parsed)) finalPaymentRefs = [...parsed, ...addPaymentRefs];
                else finalPaymentRefs = [existingTx.payment_ref, ...addPaymentRefs];
              } catch {
                finalPaymentRefs = [existingTx.payment_ref, ...addPaymentRefs];
              }
            }
          } catch (e) {
            console.warn('Failed to fetch existing payment_ref', e);
          }
          updateData.payment_ref = JSON.stringify(finalPaymentRefs);
        }
      }

      const { error: txError } = await supabase
        .from('transactions')
        .update(updateData)
        .eq('id', addToOrderId);
      if (txError) throw txError;

      // Deduct stocks
      for (const item of cart) {
        const prod = products.find(p => p.id === item.id);
        if (prod) {
          const newStock = Math.max(0, prod.stock - item.quantity);
          await supabase.from('products').update({ stock: newStock }).eq('id', prod.id);
        }
      }

      const { data: updatedProducts } = await supabase.from('products').select('*').order('name');
      if (updatedProducts) setProducts(updatedProducts);

      setIsAddToExisting(true);
      setAddToOrderConfirmVisible(false);
      setCreatedOrderId(addToOrderId);
      setCart([]);
      setAddToOrderId(null);
      setMobileCartVisible(false);
      setOrderDoneModalVisible(true);
      await loadAllOrders();

    } catch (e: any) {
      console.error('Failed to add items to existing order', e);
      Alert.alert('Error', 'Gagal menambah pesanan ke order yang ada.');
    }
  };

  // Create a new order (without payment)
  const handleCreateOrder = async () => {
    if (!customerName.trim()) {
      Alert.alert('Nama Wajib', 'Nama pelanggan harus diisi.');
      return;
    }

    const total = getCartTotal();
    const transaction: Transaction = {
      id: generateReceiptId(),
      date: new Date().toISOString(),
      items: cart.map(item => ({ ...item, completed: false })),
      total,
      cashPaid: 0,
      change: 0,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      cashierName: selectedCashier || undefined,
      paymentMethod: 'Tunai',
      notes: notes.trim() || undefined,
      status: 'pending',
      orderType,
      paymentStatus: 'unpaid',
    };

    // Save transaction to Supabase
    try {
      const { error: txError } = await supabase.from('transactions').insert([{
        id: transaction.id,
        date: transaction.date,
        total: transaction.total,
        cash_paid: 0,
        change: 0,
        customer_name: transaction.customerName || null,
        customer_phone: transaction.customerPhone || null,
        cashier_name: transaction.cashierName || null,
        payment_method: transaction.paymentMethod,
        notes: transaction.notes || null,
        status: transaction.status,
        order_type: transaction.orderType,
        payment_status: transaction.paymentStatus,
      }]);
      if (txError) throw txError;

      // Save transaction items
      const { error: itemsError } = await supabase.from('transaction_items').insert(
        cart.map(item => ({
          transaction_id: transaction.id,
          product_id: item.id,
          name: item.note ? `${item.name} (${item.note})` : item.name,
          quantity: item.quantity,
          price: item.price,
          completed: false,
          payment_status: 'unpaid',
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

      // Reload products list
      const { data: updatedProducts } = await supabase.from('products').select('*').order('name');
      if (updatedProducts) setProducts(updatedProducts);

    } catch (e: any) {
      console.error('Failed to save order to Supabase', e);
      Alert.alert('Error Database', 'Gagal menyimpan pesanan ke database online.');
      return;
    }

    setCreatedOrderId(transaction.id);
    setOrderModalVisible(false);
    setMobileCartVisible(false);
    setOrderDoneModalVisible(true);
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setNotes('');
    setOrderType('Dine In');
    await loadAllOrders();
  };

  const resetAfterOrder = () => {
    setOrderDoneModalVisible(false);
    setCreatedOrderId(null);
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
              <TextInput
                style={{
                  marginTop: 6,
                  paddingVertical: 4,
                  paddingHorizontal: 8,
                  borderWidth: 1,
                  borderColor: 'rgba(142, 142, 147, 0.3)',
                  borderRadius: 6,
                  fontSize: 12,
                  color: theme.text,
                }}
                placeholder="Catatan (opsional)..."
                placeholderTextColor={theme.textSecondary}
                value={item.note || ''}
                onChangeText={(text) => {
                  setCart(prev => prev.map(c => c.id === item.id ? { ...c, note: text } : c));
                }}
              />
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

        {/* Add to existing order button */}
        {allOrders.length > 0 && (
          <Pressable
            style={[styles.addToOrderBtn, cart.length === 0 && styles.disabledBtn]}
            onPress={handleOpenAddToOrder}
            disabled={cart.length === 0}
          >
            <ThemedText style={styles.addToOrderBtnText}>➕ Tambah ke Order</ThemedText>
          </Pressable>
        )}

        <Pressable
          style={[styles.checkoutBtn, cart.length === 0 && styles.disabledBtn]}
          onPress={handleOrderOpen}
          disabled={cart.length === 0}
        >
          <ThemedText style={styles.checkoutBtnText}>🧾 Buat Order Baru</ThemedText>
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

                {allOrders.length > 0 && (
                  <Pressable
                    style={styles.addToOrderBtn}
                    onPress={handleOpenAddToOrder}
                  >
                    <ThemedText style={styles.addToOrderBtnText}>➕ Tambah ke Order</ThemedText>
                  </Pressable>
                )}

                <Pressable style={styles.checkoutBtn} onPress={handleOrderOpen}>
                  <ThemedText style={styles.checkoutBtnText}>🧾 Buat Order Baru</ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          </View>
        </Modal>

        {/* Select Existing Order Modal */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={selectOrderModalVisible}
          onRequestClose={() => setSelectOrderModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <ThemedView type="backgroundElement" style={styles.checkoutModalContent}>
              {/* Header with X close */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.two }}>
                <ThemedText type="smallBold" style={[styles.modalTitle, { flex: 1, marginBottom: 0 }]}>
                  Tambah ke Order
                </ThemedText>
                <Pressable
                  style={styles.closeIconBtn}
                  onPress={() => setSelectOrderModalVisible(false)}
                >
                  <ThemedText style={{ fontSize: 18, fontWeight: 'bold' }}>×</ThemedText>
                </Pressable>
              </View>

              {/* Tabs Aktif / Selesai */}
              <View style={[styles.miniTabContainer, { backgroundColor: theme.backgroundSelected }]}>
                <Pressable
                  style={[
                    styles.miniTab,
                    selectOrderTab === 'pending' && { backgroundColor: '#FF9500', borderRadius: Spacing.two },
                  ]}
                  onPress={() => setSelectOrderTab('pending')}
                >
                  <ThemedText
                    type="smallBold"
                    style={{ fontSize: 13, color: selectOrderTab === 'pending' ? '#ffffff' : theme.textSecondary }}
                  >
                    ⏳ Aktif ({allOrders.filter(o => o.status === 'pending').length})
                  </ThemedText>
                </Pressable>
                <Pressable
                  style={[
                    styles.miniTab,
                    selectOrderTab === 'completed' && { backgroundColor: '#34C759', borderRadius: Spacing.two },
                  ]}
                  onPress={() => setSelectOrderTab('completed')}
                >
                  <ThemedText
                    type="smallBold"
                    style={{ fontSize: 13, color: selectOrderTab === 'completed' ? '#ffffff' : theme.textSecondary }}
                  >
                    ✓ Selesai ({allOrders.filter(o => o.status === 'completed').length})
                  </ThemedText>
                </Pressable>
              </View>

              <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: Spacing.two, paddingVertical: Spacing.two }}>
                {allOrders
                  .filter(o => o.status === selectOrderTab)
                  .length === 0 ? (
                  <View style={{ alignItems: 'center', paddingVertical: Spacing.four }}>
                    <ThemedText themeColor="textSecondary" type="small">
                      Tidak ada order {selectOrderTab === 'pending' ? 'aktif' : 'selesai'}.
                    </ThemedText>
                  </View>
                ) : (
                  allOrders
                    .filter(o => o.status === selectOrderTab)
                    .map((order) => {
                      const isPaid = (order.paymentStatus || 'paid') === 'paid';
                      return (
                        <Pressable
                          key={order.id}
                          style={[styles.orderSelectItem, { borderColor: theme.backgroundSelected }]}
                          onPress={() => handleSelectExistingOrder(order.id)}
                        >
                          <View style={{ flex: 1 }}>
                            <ThemedText type="smallBold" style={{ fontSize: 14 }}>
                              {order.customerName || 'Tanpa Nama'}
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary">
                              {order.id} · {order.orderType || 'Dine In'} · {order.items.length} item
                            </ThemedText>
                            <ThemedText
                              type="code"
                              style={{ fontSize: 11, color: isPaid ? '#34C759' : '#FF3B30', marginTop: 2 }}
                            >
                              {isPaid ? '✅ Sudah Bayar' : '❌ Belum Bayar'} · {formatRupiah(order.total)}
                            </ThemedText>
                          </View>
                          <ThemedText style={{ fontSize: 20, color: '#007AFF' }}>›</ThemedText>
                        </Pressable>
                      );
                    })
                )}
              </ScrollView>
            </ThemedView>
          </View>
        </Modal>

        {/* Add to order confirm modal */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={addToOrderConfirmVisible}
          onRequestClose={() => setAddToOrderConfirmVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <ThemedView type="backgroundElement" style={styles.checkoutModalContent}>
              <ThemedText type="smallBold" style={styles.modalTitle}>
                Tambah Pesanan
              </ThemedText>

              {addToOrderId && (() => {
                const targetOrder = allOrders.find(o => o.id === addToOrderId);
                return targetOrder ? (
                  <>
                    <View style={[styles.tagihanContainer, { marginBottom: Spacing.two }]}>
                      <ThemedText type="small" themeColor="textSecondary">Ke order milik:</ThemedText>
                      <ThemedText type="smallBold" style={{ fontSize: 16, marginTop: 2 }}>
                        {targetOrder.customerName || 'Tanpa Nama'} ({targetOrder.id})
                      </ThemedText>
                      <View style={{ flexDirection: 'row', gap: Spacing.two, marginTop: 4 }}>
                        <ThemedText type="small" themeColor="textSecondary">Sebelum: {formatRupiah(targetOrder.total)}</ThemedText>
                        <ThemedText type="small" style={{ color: '#007AFF' }}>+{formatRupiah(getCartTotal())}</ThemedText>
                      </View>
                      <ThemedText type="smallBold" style={{ color: '#007AFF', fontSize: 16, marginTop: 2 }}>
                        Total baru: {formatRupiah(targetOrder.total + getCartTotal())}
                      </ThemedText>
                    </View>

                    {/* Payment status for additions */}
                    <View style={styles.formGroup}>
                      <ThemedText type="small" style={styles.label}>Status Bayar Tambahan:</ThemedText>
                      <View style={styles.orderTypeRow}>
                        <Pressable
                          style={[
                            styles.orderTypeBtn,
                            { backgroundColor: addPaymentStatus === 'unpaid' ? '#FF3B30' : theme.backgroundSelected },
                          ]}
                          onPress={() => setAddPaymentStatus('unpaid')}
                        >
                          <ThemedText
                            type="smallBold"
                            style={{ color: addPaymentStatus === 'unpaid' ? '#ffffff' : theme.text, fontSize: 13 }}
                          >
                            ❌ Belum Bayar
                          </ThemedText>
                        </Pressable>
                        <Pressable
                          style={[
                            styles.orderTypeBtn,
                            { backgroundColor: addPaymentStatus === 'paid' ? '#34C759' : theme.backgroundSelected },
                          ]}
                          onPress={() => setAddPaymentStatus('paid')}
                        >
                          <ThemedText
                            type="smallBold"
                            style={{ color: addPaymentStatus === 'paid' ? '#ffffff' : theme.text, fontSize: 13 }}
                          >
                            ✅ Sudah Bayar
                          </ThemedText>
                        </Pressable>
                      </View>
                    </View>

                    {addPaymentStatus === 'paid' && (
                      <>
                        {/* Metode Pembayaran */}
                        <View style={styles.formGroup}>
                          <ThemedText type="small" style={styles.label}>Metode Pembayaran:</ThemedText>
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.cashierChipsScroll}
                          >
                            {(['Tunai', 'Transfer', 'QRIS Gopay', 'QRIS BPD'] as const).map((method) => {
                              const isSelected = addPaymentMethod === method;
                              return (
                                <Pressable
                                  key={method}
                                  style={[
                                    styles.cashierChip,
                                    { backgroundColor: isSelected ? '#34C759' : theme.backgroundSelected },
                                  ]}
                                  onPress={() => {
                                    setAddPaymentMethod(method);
                                    if (method !== 'Tunai') setAddCashPaid(String(getCartTotal()));
                                    else setAddCashPaid('');
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
                        {addPaymentMethod === 'Tunai' && (
                          <View style={styles.formGroup}>
                            <ThemedText type="small" style={styles.label}>Uang Tunai Bayar (Rp):</ThemedText>
                            <TextInput
                              style={[
                                styles.input,
                                {
                                  backgroundColor: theme.background,
                                  color: theme.text,
                                  borderColor: theme.backgroundSelected,
                                },
                              ]}
                              value={addCashPaid}
                              onChangeText={setAddCashPaid}
                              placeholder={`Min. ${formatRupiah(getCartTotal())}`}
                              placeholderTextColor={theme.textSecondary}
                              keyboardType="numeric"
                            />

                            {(() => {
                              const paidVal = parseFloat(addCashPaid);
                              const cartTotal = getCartTotal();
                              if (!isNaN(paidVal) && paidVal >= cartTotal) {
                                return (
                                  <View
                                    style={{
                                      flexDirection: 'row',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      padding: Spacing.two,
                                      backgroundColor: 'rgba(52, 199, 89, 0.08)',
                                      borderRadius: Spacing.two,
                                      marginTop: Spacing.one,
                                    }}
                                  >
                                    <ThemedText type="small" style={{ color: '#34C759' }}>Kembalian:</ThemedText>
                                    <ThemedText type="smallBold" style={{ color: '#34C759', fontSize: 16 }}>
                                      {formatRupiah(paidVal - cartTotal)}
                                    </ThemedText>
                                  </View>
                                );
                              }
                              return null;
                            })()}
                          </View>
                        )}
                        
                        {/* Upload bukti if not tunai */}
                        {addPaymentMethod !== 'Tunai' && (
                          <View style={[styles.formGroup, { marginTop: Spacing.two }]}>
                            <ThemedText type="small" style={styles.label}>Bukti Pembayaran (Wajib):</ThemedText>
                            {addPaymentRefs.length > 0 && (
                              <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ width: '100%', borderRadius: 8, marginBottom: 8 }}>
                                {addPaymentRefs.map((uri, idx) => (
                                  <View key={idx} style={{ position: 'relative', width: 280, marginRight: 8 }}>
                                    <Image 
                                      source={{ uri }} 
                                      style={{ width: '100%', height: 160, borderRadius: 8, backgroundColor: 'rgba(128,128,128,0.2)' }} 
                                      resizeMode="cover" 
                                    />
                                    <Pressable 
                                      style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', padding: 6, borderRadius: 12 }}
                                      onPress={() => setAddPaymentRefs(prev => prev.filter((_, i) => i !== idx))}
                                    >
                                      <ThemedText style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>Hapus</ThemedText>
                                    </Pressable>
                                  </View>
                                ))}
                              </ScrollView>
                            )}
                            <Pressable
                              style={{
                                borderWidth: 1,
                                borderColor: '#007AFF',
                                borderStyle: 'dashed',
                                borderRadius: 8,
                                height: addPaymentRefs.length > 0 ? 60 : 120,
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: 'rgba(0,122,255,0.05)'
                              }}
                              onPress={handlePickAddImage}
                            >
                              {!addPaymentRefs.length && <ThemedText style={{ fontSize: 24, marginBottom: 8 }}>🖼️</ThemedText>}
                              <ThemedText type="smallBold" style={{ color: '#007AFF' }}>{addPaymentRefs.length > 0 ? '+ Tambah Bukti Lain' : '+ Upload dari Galeri'}</ThemedText>
                            </Pressable>
                          </View>
                        )}
                      </>
                    )}
                  </>
                ) : null;
              })()}

              <View style={styles.modalActions}>
                <Pressable
                  style={[styles.modalBtn, styles.cancelBtn]}
                  onPress={() => setAddToOrderConfirmVisible(false)}
                >
                  <ThemedText style={styles.cancelBtnText}>Batal</ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.modalBtn, styles.saveBtn]}
                  onPress={handleAddItemsToExistingOrder}
                >
                  <ThemedText style={styles.saveBtnText}>Tambahkan</ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          </View>
        </Modal>

        {/* Create Order Modal */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={orderModalVisible}
          onRequestClose={() => setOrderModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <ThemedView type="backgroundElement" style={styles.checkoutModalContent}>
              <ThemedText type="smallBold" style={styles.modalTitle}>
                Buat Order
              </ThemedText>

              <ScrollView style={{ maxHeight: 420 }}>
                {/* Total tagihan */}
                <View style={styles.tagihanContainer}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Total Tagihan:
                  </ThemedText>
                  <ThemedText type="subtitle" style={styles.tagihanTotal}>
                    {formatRupiah(getCartTotal())}
                  </ThemedText>
                </View>

                {/* Takeaway / Dine In */}
                <View style={styles.formGroup}>
                  <ThemedText type="small" style={styles.label}>
                    Tipe Order
                  </ThemedText>
                  <View style={styles.orderTypeRow}>
                    <Pressable
                      style={[
                        styles.orderTypeBtn,
                        orderType === 'Dine In' && styles.orderTypeBtnActiveDineIn,
                        { backgroundColor: orderType === 'Dine In' ? '#007AFF' : theme.backgroundSelected },
                      ]}
                      onPress={() => setOrderType('Dine In')}
                    >
                      <ThemedText
                        type="smallBold"
                        style={{ color: orderType === 'Dine In' ? '#ffffff' : theme.text, fontSize: 14 }}
                      >
                        🍽️ Dine In
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.orderTypeBtn,
                        orderType === 'Takeaway' && styles.orderTypeBtnActiveTakeaway,
                        { backgroundColor: orderType === 'Takeaway' ? '#FF9500' : theme.backgroundSelected },
                      ]}
                      onPress={() => setOrderType('Takeaway')}
                    >
                      <ThemedText
                        type="smallBold"
                        style={{ color: orderType === 'Takeaway' ? '#ffffff' : theme.text, fontSize: 14 }}
                      >
                        🥡 Takeaway
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>

                {/* Nama Pelanggan (wajib) */}
                <View style={styles.formGroup}>
                  <ThemedText type="small" style={styles.label}>
                    Nama Pelanggan <ThemedText style={{ color: '#FF3B30' }}>*</ThemedText>
                  </ThemedText>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.background,
                        color: theme.text,
                        borderColor: customerName.trim() === '' ? '#FF3B30' : theme.backgroundSelected,
                      },
                    ]}
                    value={customerName}
                    onChangeText={setCustomerName}
                    placeholder="Contoh: Pak Budi"
                    placeholderTextColor={theme.textSecondary}
                    autoFocus
                  />
                  {customerName.trim() === '' && (
                    <ThemedText type="code" style={{ color: '#FF3B30', fontSize: 11, marginTop: 2 }}>
                      Nama pelanggan wajib diisi
                    </ThemedText>
                  )}
                </View>

                {/* No. Telepon (opsional) */}
                <View style={styles.formGroup}>
                  <ThemedText type="small" style={styles.label}>
                    No. WhatsApp <ThemedText type="code" style={{ color: theme.textSecondary, fontSize: 11 }}>(opsional)</ThemedText>
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

                {/* Catatan */}
                <View style={styles.formGroup}>
                  <ThemedText type="small" style={styles.label}>
                    Catatan Pesanan <ThemedText type="code" style={{ color: theme.textSecondary, fontSize: 11 }}>(opsional)</ThemedText>
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
                  onPress={() => setOrderModalVisible(false)}
                >
                  <ThemedText style={styles.cancelBtnText}>Batal</ThemedText>
                </Pressable>
                <Pressable
                  style={[
                    styles.modalBtn,
                    styles.saveBtn,
                    !customerName.trim() && styles.disabledBtn,
                  ]}
                  onPress={handleCreateOrder}
                  disabled={!customerName.trim()}
                >
                  <ThemedText style={styles.saveBtnText}>✅ Buat Order</ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          </View>
        </Modal>

        {/* Order Created Success Modal */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={orderDoneModalVisible}
          onRequestClose={resetAfterOrder}
        >
          <View style={styles.modalOverlay}>
            <ThemedView type="backgroundElement" style={[styles.receiptModalContent, { position: 'relative' }]}>
              {/* X close button */}
              <Pressable style={styles.absoluteCloseBtn} onPress={resetAfterOrder}>
                <ThemedText style={{ fontSize: 20, fontWeight: 'bold', lineHeight: 22 }}>×</ThemedText>
              </Pressable>

              <View style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: 'rgba(52, 199, 89, 0.15)',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: Spacing.two
              }}>
                <View style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: '#34C759',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <ThemedText style={{ color: '#fff', fontSize: 28, fontWeight: 'bold', marginTop: -2 }}>✓</ThemedText>
                </View>
              </View>

              <ThemedText type="smallBold" style={[styles.modalTitle, { textAlign: 'center' }]}>
                {isAddToExisting ? 'Pesanan Ditambahkan!' : 'Order Dibuat!'}
              </ThemedText>

              {createdOrderId && (
                <View style={[styles.tagihanContainer, { marginTop: Spacing.two, width: '100%' }]}>
                  <ThemedText type="code" themeColor="textSecondary">No. Order:</ThemedText>
                  <ThemedText type="smallBold" style={{ fontSize: 20, color: '#007AFF', marginTop: 2 }}>
                    {createdOrderId}
                  </ThemedText>
                </View>
              )}

              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={{ textAlign: 'center', marginTop: Spacing.two, marginBottom: Spacing.three, lineHeight: 20 }}
              >
                {isAddToExisting
                  ? 'Item berhasil ditambahkan ke order yang dipilih.'
                  : 'Order masuk ke antrian. Pembayaran dapat dilakukan nanti di tab Pesanan.'}
              </ThemedText>

              <Pressable
                style={styles.doneBtn}
                onPress={() => {
                  setIsAddToExisting(false);
                  resetAfterOrder();
                }}
              >
                <ThemedText style={styles.doneBtnText}>Selesai</ThemedText>
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
  addToOrderBtn: {
    backgroundColor: '#FF9500',
    height: 44,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addToOrderBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  checkoutBtn: {
    backgroundColor: '#007AFF',
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
    paddingVertical: Spacing.three,
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
    borderRadius: Spacing.three,
    marginBottom: Spacing.two,
  },
  tagihanTotal: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#007AFF',
    marginTop: Spacing.half,
  },
  orderTypeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  orderTypeBtn: {
    flex: 1,
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderTypeBtnActiveDineIn: {
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  orderTypeBtnActiveTakeaway: {
    shadowColor: '#FF9500',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
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
    borderRadius: 28,
    padding: Spacing.four + 8,
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
  },
  doneBtn: {
    width: '100%',
    height: 54,
    backgroundColor: '#007AFF',
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.three,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  doneBtnText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 16,
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
  orderSelectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  closeIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(142, 142, 147, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniTabContainer: {
    flexDirection: 'row',
    borderRadius: Spacing.two,
    padding: 4,
    marginBottom: Spacing.two,
  },
  miniTab: {
    flex: 1,
    paddingVertical: Spacing.one + 2,
    alignItems: 'center',
    justifyContent: 'center',
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
