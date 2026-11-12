import { placeholder } from './placeholder.js';

export default {
  subtitle: 'Stok bahan mentah outlet.',
  render(view) {
    placeholder(view, {
      iconName: 'box',
      title: 'Stok sedang dipindahkan',
      text: 'Smart Inventori akan dimasukkan terus ke sini (Fasa 4). Buat masa ini, buka halaman Smart Inventori.',
      link: { href: '../inventory-emerald-v1.html', label: 'Buka Smart Inventori' }
    });
  }
};
