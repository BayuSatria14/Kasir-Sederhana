import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Modal,
  Alert,
  Platform,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRupiah } from '@/utils/receipt';
import { supabase } from '@/utils/supabase';

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
}

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

const CATEGORIES = ['Semua', 'Makanan', 'Minuman', 'Gorengan'];

export default function ProductsScreen() {
  const theme = useTheme();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua');
  
  // Modal states
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Makanan');
  const [stock, setStock] = useState('999');

  const loadProducts = async () => {
    try {
      const { data, error } = await supabase.from('products').select('*').order('name');
      if (error) throw error;
      if (data && data.length > 0) {
        setProducts(data);
      } else {
        const { error: insertError } = await supabase.from('products').insert(DEFAULT_PRODUCTS);
        if (!insertError) {
          setProducts(DEFAULT_PRODUCTS);
        } else {
          console.error('Failed to insert default products', insertError);
          setProducts(DEFAULT_PRODUCTS);
        }
      }
    } catch (e) {
      console.error('Failed to load products from Supabase', e);
      Alert.alert('Error', 'Gagal memuat produk dari database online.');
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  // Realtime: auto-sync products across devices
  useEffect(() => {
    const channel = supabase
      .channel('products-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        loadProducts();
      })
      .subscribe((status, err) => {
        console.log('Realtime (products.tsx) Status:', status, err ? err : '');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleOpenAdd = () => {
    setEditingProduct(null);
    setName('');
    setPrice('');
    setCategory('Makanan');
    setStock('999');
    setModalVisible(true);
  };

  const handleOpenEdit = (product: Product) => {
    setEditingProduct(product);
    setName(product.name);
    setPrice(product.price.toString());
    setCategory(product.category);
    setStock(product.stock.toString());
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Nama produk tidak boleh kosong');
      return;
    }
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      Alert.alert('Error', 'Harga produk harus berupa angka positif');
      return;
    }
    const parsedStock = parseInt(stock);
    if (isNaN(parsedStock) || parsedStock < 0) {
      Alert.alert('Error', 'Stok produk harus berupa angka minimal 0');
      return;
    }

    try {
      if (editingProduct) {
        // Edit
        const { error } = await supabase
          .from('products')
          .update({
            name: name.trim(),
            price: parsedPrice,
            category,
            stock: parsedStock,
          })
          .eq('id', editingProduct.id);
        if (error) throw error;
      } else {
        // Add
        const newProduct: Product = {
          id: 'p-' + Date.now(),
          name: name.trim(),
          price: parsedPrice,
          category,
          stock: parsedStock,
        };
        const { error } = await supabase.from('products').insert([newProduct]);
        if (error) throw error;
      }
      loadProducts();
      setModalVisible(false);
    } catch (e) {
      console.error('Failed to save product', e);
      Alert.alert('Error', 'Gagal menyimpan produk ke database online.');
    }
  };

  const handleDelete = (product: Product) => {
    const performDelete = async () => {
      try {
        const { error } = await supabase.from('products').delete().eq('id', product.id);
        if (error) throw error;
        loadProducts();
      } catch (e) {
        console.error('Failed to delete product', e);
        Alert.alert('Error', 'Gagal menghapus produk dari database online.');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Hapus produk "${product.name}"?`)) {
        performDelete();
      }
    } else {
      Alert.alert(
        'Hapus Produk',
        `Apakah Anda yakin ingin menghapus "${product.name}"?`,
        [
          { text: 'Batal', style: 'cancel' },
          { text: 'Hapus', style: 'destructive', onPress: performDelete },
        ]
      );
    }
  };

  // Filter products
  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === 'Semua' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Header */}
        <ThemedView style={styles.header}>
          <ThemedText type="subtitle" style={styles.headerTitle}>
            Kelola Produk
          </ThemedText>
          <Pressable style={styles.addButton} onPress={handleOpenAdd}>
            <ThemedText style={styles.addButtonText}>+ Produk Baru</ThemedText>
          </Pressable>
        </ThemedView>

        {/* Search & Category Filter */}
        <ThemedView style={styles.filterSection}>
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
            {CATEGORIES.map((cat) => {
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
        </ThemedView>

        {/* Product List */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          {filteredProducts.length === 0 ? (
            <ThemedView style={styles.emptyContainer}>
              <ThemedText themeColor="textSecondary">
                Tidak ada produk ditemukan.
              </ThemedText>
            </ThemedView>
          ) : (
            filteredProducts.map((product) => (
              <ThemedView
                key={product.id}
                type="backgroundElement"
                style={styles.productCard}
              >
                <View style={styles.productInfo}>
                  <ThemedText type="default" style={styles.productName}>
                    {product.name}
                  </ThemedText>
                  <View style={styles.productMeta}>
                    <ThemedView
                      style={[
                        styles.badge,
                        { backgroundColor: theme.backgroundSelected },
                      ]}
                    >
                      <ThemedText type="code" style={styles.badgeText}>
                        {product.category}
                      </ThemedText>
                    </ThemedView>
                    <ThemedText type="small" themeColor="textSecondary">
                      Stok: {product.stock}
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold" style={styles.productPrice}>
                    {formatRupiah(product.price)}
                  </ThemedText>
                </View>
                <View style={styles.cardActions}>
                  <Pressable
                    style={[styles.actionBtn, styles.editBtn]}
                    onPress={() => handleOpenEdit(product)}
                  >
                    <ThemedText style={styles.editBtnText}>Edit</ThemedText>
                  </Pressable>
                  <Pressable
                    style={[styles.actionBtn, styles.deleteBtn]}
                    onPress={() => handleDelete(product)}
                  >
                    <ThemedText style={styles.deleteBtnText}>Hapus</ThemedText>
                  </Pressable>
                </View>
              </ThemedView>
            ))
          )}
        </ScrollView>

        {/* Add/Edit Modal */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={modalVisible}
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <ThemedView type="backgroundElement" style={styles.modalContent}>
              <ThemedText type="smallBold" style={styles.modalTitle}>
                {editingProduct ? 'Ubah Produk' : 'Tambah Produk Baru'}
              </ThemedText>

              {/* Form Fields */}
              <View style={styles.formGroup}>
                <ThemedText type="small" style={styles.label}>
                  Nama Produk
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
                  value={name}
                  onChangeText={setName}
                  placeholder="Contoh: Kopi Cappuccino"
                  placeholderTextColor={theme.textSecondary}
                />
              </View>

              <View style={styles.formGroup}>
                <ThemedText type="small" style={styles.label}>
                  Harga (Rupiah)
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
                  value={price}
                  onChangeText={setPrice}
                  placeholder="Contoh: 15000"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.formGroup}>
                <ThemedText type="small" style={styles.label}>
                  Kategori
                </ThemedText>
                <View style={styles.modalCategoryRow}>
                  {['Makanan', 'Minuman', 'Gorengan'].map((cat) => {
                    const isSel = category === cat;
                    return (
                      <Pressable
                        key={cat}
                        style={[
                          styles.modalCategoryBtn,
                          {
                            backgroundColor: isSel
                              ? theme.text
                              : theme.background,
                            borderColor: theme.backgroundSelected,
                          },
                        ]}
                        onPress={() => setCategory(cat)}
                      >
                        <ThemedText
                          type="smallBold"
                          style={{
                            color: isSel ? theme.background : theme.text,
                          }}
                        >
                          {cat}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.formGroup}>
                <ThemedText type="small" style={styles.label}>
                  Stok
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
                  value={stock}
                  onChangeText={setStock}
                  placeholder="Contoh: 999"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="numeric"
                />
              </View>

              {/* Action Buttons */}
              <View style={styles.modalActions}>
                <Pressable
                  style={[styles.modalBtn, styles.cancelBtn]}
                  onPress={() => setModalVisible(false)}
                >
                  <ThemedText style={styles.cancelBtnText}>Batal</ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.modalBtn, styles.saveBtn]}
                  onPress={handleSave}
                >
                  <ThemedText style={styles.saveBtnText}>Simpan</ThemedText>
                </Pressable>
              </View>
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
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  addButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  addButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
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
  scrollView: {
    flex: 1,
  },
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
  productCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  productInfo: {
    flex: 1,
    gap: Spacing.one,
  },
  productName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  productMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
  },
  badgeText: {
    fontSize: 10,
    textTransform: 'uppercase',
  },
  productPrice: {
    fontSize: 16,
    color: '#34C759',
  },
  cardActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  actionBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editBtn: {
    backgroundColor: '#FF9500',
  },
  editBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  deleteBtn: {
    backgroundColor: '#FF3B30',
  },
  deleteBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
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
    maxWidth: 400,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: Spacing.one,
  },
  formGroup: {
    gap: Spacing.one,
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
  modalCategoryRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  modalCategoryBtn: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  modalBtn: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    minWidth: 80,
    alignItems: 'center',
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
});
