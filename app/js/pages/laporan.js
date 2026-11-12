import { placeholder } from './placeholder.js';

export default {
  subtitle: 'Laporan harian, mingguan, bulanan dan tahunan.',
  render(view) {
    placeholder(view, {
      iconName: 'chart',
      title: 'Laporan sedang dipindahkan',
      text: 'Laporan ikut tempoh akan ada di sini (Fasa 4). Buat masa ini, buka app kewangan lama.',
      link: { href: '../lama.html', label: 'Buka laporan lama' }
    });
  }
};
