export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  completed?: boolean;
  dbId?: string;
  paymentStatus?: 'paid' | 'unpaid';
  note?: string;
}

export interface Transaction {
  id: string;
  date: string;
  items: CartItem[];
  total: number;
  cashPaid: number;
  change: number;
  customerName?: string;
  customerPhone?: string;
  cashierName?: string;
  paymentMethod: 'Tunai' | 'Transfer' | 'QRIS Gopay' | 'QRIS BPD';
  notes?: string;
  status?: 'pending' | 'completed';
  orderType?: 'Takeaway' | 'Dine In';
  paymentStatus?: 'paid' | 'unpaid';
}

/**
 * Generates a short, unique receipt ID.
 * Format: STK- followed by a 6-digit random number string.
 * Example: STK-385012
 */
export function generateReceiptId(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return `STK-${code}`;
}

/**
 * Gets the local YYYY-MM-DD date string from an ISO date string or Date object.
 */
export function getLocalDatePart(dateInput: string | Date = new Date()): string {
  try {
    let d: Date;
    if (typeof dateInput === 'string') {
      const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        d = new Date(Date.UTC(
          parseInt(match[1]),
          parseInt(match[2]) - 1,
          parseInt(match[3]),
          parseInt(match[4]),
          parseInt(match[5]),
          parseInt(match[6])
        ));
      } else {
        d = new Date(dateInput);
      }
    } else {
      d = dateInput;
    }
    
    if (isNaN(d.getTime())) {
      throw new Error('Invalid Date');
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return typeof dateInput === 'string' ? dateInput.split('T')[0] : '';
  }
}



/**
 * Formats a number to Rupiah currency format.
 */
export function formatRupiah(value: number): string {
  try {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return 'Rp ' + String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
}

/**
 * Formats an ISO date string to a readable format (DD/MM/YYYY HH:MM).
 */
export function formatDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  } catch {
    return dateStr;
  }
}

/**
 * Generates a formatted text receipt for WhatsApp sharing.
 */
export function formatWhatsAppReceipt(transaction: Transaction, shopName: string = 'IGA BABI MELTIQ'): string {
  const lineSeparator = '--------------------------------';
  let text = `*=== ${shopName.toUpperCase()} ===*\n`;
  text += `*Struk Pembelian*\n\n`;
  text += `No. Struk: _${transaction.id}_\n`;
  text += `Tanggal: ${formatDateTime(transaction.date)}\n`;

  if (transaction.orderType) {
    text += `Tipe Order: *${transaction.orderType}*\n`;
  }
  if (transaction.customerName) {
    text += `Pelanggan: *${transaction.customerName}*\n`;
  }
  if (transaction.cashierName) {
    text += `Kasir: *${transaction.cashierName}*\n`;
  }
  text += `Metode Bayar: *${transaction.paymentMethod || 'Tunai'}*\n`;
  if (transaction.notes) {
    text += `Catatan: _${transaction.notes}_\n`;
  }

  text += `${lineSeparator}\n`;

  transaction.items.forEach((item) => {
    const subtotal = item.price * item.quantity;
    text += `*${item.name}*\n`;
    text += `${item.quantity}x ${formatRupiah(item.price)} = ${formatRupiah(subtotal)}\n`;
  });

  text += `${lineSeparator}\n`;
  text += `*Total:* ${formatRupiah(transaction.total)}\n`;
  text += `*Bayar:* ${formatRupiah(transaction.cashPaid)}\n`;
  text += `*Kembalian:* ${formatRupiah(transaction.change)}\n`;
  text += `${lineSeparator}\n`;
  text += `_Terima kasih atas kunjungan Anda!_\n`;
  text += `_Semoga hari Anda menyenangkan._`;

  return encodeURIComponent(text);
}

/**
 * Generates HTML content representing the receipt, optimized for thermal printer view.
 */
export function generateHTMLReceipt(transaction: Transaction, shopName: string = 'IGA BABI MELTIQ'): string {
  const itemsHtml = transaction.items.map((item) => {
    const subtotal = item.price * item.quantity;
    return `
      <div style="margin-bottom: 8px;">
        <div style="font-weight: bold;">${item.name}</div>
        <div style="display: flex; justify-content: space-between; font-size: 13px;">
          <span>${item.quantity}x ${formatRupiah(item.price)}</span>
          <span>${formatRupiah(subtotal)}</span>
        </div>
      </div>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Struk Belanja</title>
      <style>
        body {
          font-family: 'Courier New', Courier, monospace;
          margin: 0;
          padding: 20px;
          background-color: #ffffff;
          color: #000000;
          font-size: 14px;
          line-height: 1.4;
        }
        .container {
          max-width: 320px;
          margin: 0 auto;
        }
        .text-center {
          text-align: center;
        }
        .text-right {
          text-align: right;
        }
        .bold {
          font-weight: bold;
        }
        .title {
          font-size: 18px;
          margin-bottom: 5px;
        }
        .divider {
          border-top: 1px dashed #000000;
          margin: 12px 0;
        }
        .row {
          display: flex;
          justify-content: space-between;
        }
        .footer {
          margin-top: 25px;
          font-style: italic;
          font-size: 13px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="text-center bold title">${shopName}</div>
        <div class="text-center">STRUK BELANJA</div>
        <div class="divider"></div>
        
        <div style="font-size: 13px; margin-bottom: 4px;">
          <div>No. Struk: ${transaction.id}</div>
          <div>Tanggal: ${formatDateTime(transaction.date)}</div>
          ${transaction.orderType ? `<div>Tipe Order: ${transaction.orderType}</div>` : ''}
          ${transaction.customerName ? `<div>Pelanggan: ${transaction.customerName}</div>` : ''}
          ${transaction.cashierName ? `<div>Kasir: ${transaction.cashierName}</div>` : ''}
          <div>Metode Bayar: ${transaction.paymentMethod || 'Tunai'}</div>
          ${transaction.notes ? `<div>Catatan: ${transaction.notes}</div>` : ''}
        </div>
        
        <div class="divider"></div>
        
        <div class="items-list">
          ${itemsHtml}
        </div>
        
        <div class="divider"></div>
        
        <div class="row bold">
          <span>TOTAL</span>
          <span>${formatRupiah(transaction.total)}</span>
        </div>
        <div class="row" style="margin-top: 4px;">
          <span>TUNAI</span>
          <span>${formatRupiah(transaction.cashPaid)}</span>
        </div>
        <div class="row" style="margin-top: 4px;">
          <span>KEMBALIAN</span>
          <span>${formatRupiah(transaction.change)}</span>
        </div>
        
        <div class="divider"></div>
        
        <div class="text-center footer">
          Terima kasih atas kunjungan Anda!<br>
          Semoga hari Anda menyenangkan.
        </div>
      </div>
    </body>
    </html>
  `;
}
