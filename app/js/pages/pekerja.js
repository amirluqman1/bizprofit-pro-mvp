import { placeholder } from './placeholder.js';

export default {
  subtitle: 'Kehadiran dan gaji pekerja.',
  render(view) {
    placeholder(view, {
      iconName: 'users',
      title: 'Pekerja akan datang',
      text: 'Senarai pekerja, kehadiran harian dan payroll akan dibina di sini (Fasa 5).'
    });
  }
};
