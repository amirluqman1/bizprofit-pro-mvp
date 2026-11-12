import { placeholder } from './placeholder.js';

export default {
  subtitle: 'Ringkasan prestasi perniagaan hari ini.',
  render(view) {
    placeholder(view, {
      iconName: 'chart',
      title: 'Halaman Utama sedang dibina',
      text: 'Profit Bersih, Jualan, Perbelanjaan, Transaksi dan graf 7 hari akan muncul di sini (Fasa 3).'
    });
  }
};
