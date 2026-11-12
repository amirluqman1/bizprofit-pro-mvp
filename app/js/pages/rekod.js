import { placeholder } from './placeholder.js';

export default {
  subtitle: 'Key in dan semak transaksi.',
  render(view) {
    placeholder(view, {
      iconName: 'receipt',
      title: 'Rekod sedang dipindahkan',
      text: 'Key In dan senarai transaksi akan ada di sini (Fasa 4). Buat masa ini, guna app kewangan lama.',
      link: { href: '../lama.html', label: 'Buka app kewangan lama' }
    });
  }
};
