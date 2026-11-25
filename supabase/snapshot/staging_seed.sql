-- =====================================================================
-- BizProfit Pro · Data palsu untuk STAGING (JANGAN jalankan di production)
--
-- Jalankan selepas production_schema.sql. Semua nama, nombor dan jumlah
-- adalah rekaan. Kata laluan TIDAK disimpan di sini (repo public): set dulu
-- dalam sesi yang sama sebelum jalankan fail ini:
--
--     select set_config('app.seed_password', '<kata laluan>', false);
--
-- Akaun ujian (semua guna kata laluan yang sama):
--   Syarikat A "Demo Roti Canai Sdn Bhd" (pakej Business, 2 outlet)
--     owner.demo@example.com    owner   (semua outlet)
--     admin.demo@example.com    admin   (Outlet Bangi)
--     manager.demo@example.com  manager (Outlet Bangi)
--     staff.demo@example.com    staff   (Outlet Bangi)
--   Syarikat B "Syarikat Lain Enterprise" (pakej Free, trial tamat)
--     owner.lain@example.com    owner   -> untuk uji pengasingan syarikat
-- =====================================================================
begin;

do $$
declare
  pw text := current_setting('app.seed_password', true);
  -- ID tetap supaya senang dirujuk dalam ujian
  biz_a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  biz_b uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
  o_bangi uuid := 'aaaaaaaa-0000-4000-8000-0000000000a1';
  o_kajang uuid := 'aaaaaaaa-0000-4000-8000-0000000000a2';
  o_lain uuid := 'bbbbbbbb-0000-4000-8000-0000000000b1';
  u_owner uuid := 'aaaaaaaa-0000-4000-8000-00000000f001';
  u_admin uuid := 'aaaaaaaa-0000-4000-8000-00000000f002';
  u_manager uuid := 'aaaaaaaa-0000-4000-8000-00000000f003';
  u_staff uuid := 'aaaaaaaa-0000-4000-8000-00000000f004';
  u_lain uuid := 'bbbbbbbb-0000-4000-8000-00000000f001';
  e_ali uuid := 'aaaaaaaa-0000-4000-8000-00000000e001';
  e_siti uuid := 'aaaaaaaa-0000-4000-8000-00000000e002';
  e_raju uuid := 'aaaaaaaa-0000-4000-8000-00000000e003';
  e_mgr uuid := 'aaaaaaaa-0000-4000-8000-00000000e004';
  e_kajang uuid := 'aaaaaaaa-0000-4000-8000-00000000e005';
  e_lain uuid := 'bbbbbbbb-0000-4000-8000-00000000e001';
  today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  u record;
  d int;
begin
  if pw is null or length(pw) < 8 then
    raise exception 'Set app.seed_password (sekurang-kurangnya 8 aksara) sebelum jalankan seed';
  end if;
  if exists (select 1 from public.businesses where id not in (biz_a, biz_b)) then
    raise exception 'Database ini ada syarikat lain. Seed hanya untuk staging kosong!';
  end if;

  -- ---------- Akaun login ----------
  for u in select * from (values
      (u_owner, 'owner.demo@example.com'), (u_admin, 'admin.demo@example.com'),
      (u_manager, 'manager.demo@example.com'), (u_staff, 'staff.demo@example.com'),
      (u_lain, 'owner.lain@example.com')) v(id, email)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt(pw, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
      'email', now(), now(), now());
  end loop;

  -- ---------- Syarikat & outlet ----------
  insert into public.businesses (id, name, plan, plan_until, trial_ends_at) values
    (biz_a, 'Demo Roti Canai Sdn Bhd', 'business', null, null),
    (biz_b, 'Syarikat Lain Enterprise', 'free', null, now() - interval '1 day');
  insert into public.outlets (id, business_id, name, company_name, company_reg_no) values
    (o_bangi, biz_a, 'Outlet Bangi', 'Demo Roti Canai Sdn Bhd', '202601000001 (0000001-X)'),
    (o_kajang, biz_a, 'Outlet Kajang', 'Demo Roti Canai Sdn Bhd', '202601000001 (0000001-X)'),
    (o_lain, biz_b, 'Kedai Lain', null, null);

  insert into public.staff_profiles (user_id, business_id, outlet_id, role) values
    (u_owner, biz_a, o_bangi, 'owner'),
    (u_admin, biz_a, o_bangi, 'admin'),
    (u_manager, biz_a, o_bangi, 'manager'),
    (u_staff, biz_a, o_bangi, 'staff'),
    (u_lain, biz_b, o_lain, 'owner');

  -- ---------- Kategori & kaedah bayaran (sama seperti production) ----------
  insert into public.categories (business_id, key, name, type, counts_in_profit, is_sales)
  select b, c.key, c.name, c.type, c.cip, c.sales
  from unnest(array[biz_a, biz_b]) b,
  (values
    ('IN01','Shop Sales','In',true,true), ('IN02','Orders & Catering','In',true,true),
    ('IN03','Wholesale / Frozen Roti','In',true,true), ('IN04','Other Income','In',true,false),
    ('IN05','Owner Money Added','In',false,false), ('IN06','Loan Received','In',false,false),
    ('OUT01','Ingredients','Out',true,false), ('OUT02','LPG Gas','Out',true,false),
    ('OUT03','Packaging','Out',true,false), ('OUT04','Shop Rent','Out',true,false),
    ('OUT05','Electricity, Water & Internet','Out',true,false), ('OUT06','Staff Wages','Out',true,false),
    ('OUT07','EPF, SOCSO & EIS','Out',true,false), ('OUT08','Bank & E-wallet Fees','Out',true,false),
    ('OUT09','Transport','Out',true,false), ('OUT10','Marketing & Ads','Out',true,false),
    ('OUT11','Cleaning','Out',true,false), ('OUT12','Repairs & Maintenance','Out',true,false),
    ('OUT13','Small Equipment','Out',true,false), ('OUT14','Licences, Permits & Insurance','Out',true,false),
    ('OUT15','Loan Interest','Out',true,false), ('OUT16','Other Business Costs','Out',true,false),
    ('OUT17','Owner Money Taken','Out',false,false), ('OUT18','Loan Amount Repaid','Out',false,false),
    ('OUT19','Income Tax Paid','Out',false,false), ('OUT20','Asset & Equipment Purchase','Out',false,false)
  ) c(key, name, type, cip, sales);

  insert into public.payment_methods (business_id, name)
  select b, m from unnest(array[biz_a, biz_b]) b,
    unnest(array['Cash','DuitNow QR','E-wallet','Card','Bank Transfer','Other']) m;

  -- ---------- Transaksi 30 hari (jumlah rekaan, boleh diulang) ----------
  for d in 0..29 loop
    insert into public.transactions (business_id, outlet_id, transaction_date, type, category, amount, description, payment_method, created_by, created_at)
    values
      (biz_a, o_bangi, today - d, 'In', 'Shop Sales', 850 + (d * 37) % 400, 'Jualan pagi', 'Cash', u_staff, now() - make_interval(days => d)),
      (biz_a, o_bangi, today - d, 'In', 'Shop Sales', 420 + (d * 53) % 250, 'Jualan petang', 'DuitNow QR', u_staff, now() - make_interval(days => d)),
      (biz_a, o_bangi, today - d, 'Out', 'Ingredients', 280 + (d * 29) % 160, 'Tepung, minyak, telur', 'Cash', u_manager, now() - make_interval(days => d)),
      (biz_a, o_kajang, today - d, 'In', 'Shop Sales', 610 + (d * 41) % 300, 'Jualan harian', 'Cash', u_owner, now() - make_interval(days => d)),
      (biz_a, o_kajang, today - d, 'Out', 'Ingredients', 190 + (d * 23) % 120, 'Bahan mentah', 'Cash', u_owner, now() - make_interval(days => d)),
      (biz_b, o_lain, today - d, 'In', 'Shop Sales', 300 + (d * 17) % 100, 'Jualan (syarikat lain)', 'Cash', u_lain, now() - make_interval(days => d));
    if d % 7 = 0 then
      insert into public.transactions (business_id, outlet_id, transaction_date, type, category, amount, description, payment_method, created_by, created_at)
      values (biz_a, o_bangi, today - d, 'Out', 'LPG Gas', 95, 'Gas 2 tong', 'Cash', u_manager, now() - make_interval(days => d));
    end if;
  end loop;
  insert into public.transactions (business_id, outlet_id, transaction_date, type, category, amount, description, payment_method, created_by)
  values (biz_a, o_bangi, today - 2, 'Out', 'Shop Rent', 2500, 'Sewa kedai bulan ini', 'Bank Transfer', u_owner),
         (biz_a, o_bangi, today - 3, 'Out', 'Electricity, Water & Internet', 380, 'Bil TNB + air + internet', 'Bank Transfer', u_owner);

  -- ---------- Pekerja & kehadiran 14 hari ----------
  insert into public.employees (id, business_id, outlet_id, name, position, phone, pay_type, rate, ot_rate, is_manager, user_id) values
    (e_ali, biz_a, o_bangi, 'Ali Demo', 'Tukang masak', '0100000001', 'harian', 70, 10, false, null),
    (e_siti, biz_a, o_bangi, 'Siti Demo', 'Juruwang', '0100000002', 'mingguan', 450, 8, false, u_staff),
    (e_raju, biz_a, o_bangi, 'Raju Demo', 'Pembantu', '0100000003', 'bulanan', 1800, 9, false, null),
    (e_mgr, biz_a, o_bangi, 'Mira Demo', 'Pengurus', '0100000004', 'bulanan', 2800, 0, true, u_manager),
    (e_kajang, biz_a, o_kajang, 'Kamal Demo', 'Tukang masak', '0100000005', 'harian', 75, 10, false, null),
    (e_lain, biz_b, o_lain, 'Pekerja Lain', 'Pembantu', '0100000009', 'harian', 60, 0, false, null);

  -- attendance_touch() isi marked_by dari auth.uid(): menyamar owner semasa seed
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  insert into public.attendance (business_id, employee_id, work_date, status, ot_hours)
  select biz_a, e.id, today - g.x,
         case when g.x % 7 = 6 then 'cuti' when (g.x + e.n) % 11 = 0 then 'separuh' else 'hadir' end,
         case when g.x % 5 = 0 then 2 else 0 end
  from generate_series(1, 14) g(x),
       (values (e_ali, 1), (e_siti, 2), (e_raju, 3), (e_mgr, 4), (e_kajang, 5)) e(id, n);

  -- Satu slip gaji draf (Ali, minggu lepas) + satu advance (Raju)
  insert into public.payroll (business_id, employee_id, period_start, period_end, pay_type, rate, days_worked, ot_hours, ot_rate, base_amount, ot_amount, created_by)
  values (biz_a, e_ali, today - 13, today - 7, 'harian', 70, 6, 4, 10, 420, 40, u_owner);
  with tx as (
    insert into public.transactions (business_id, outlet_id, transaction_date, type, category, amount, description, payment_method, created_by)
    values (biz_a, o_bangi, today - 5, 'Out', 'Staff Wages', 200, 'Advance gaji Raju Demo', 'Cash', u_owner)
    returning id)
  insert into public.salary_advances (business_id, employee_id, amount, advance_date, payment_method, transaction_id, created_by)
  select biz_a, e_raju, 200, today - 5, 'Cash', id, u_owner from tx;

  -- ---------- Stok (trigger perlukan login: masih menyamar owner) ----------
  insert into public.inventory_items (business_id, outlet_id, name, unit, current_qty, min_qty, target_qty, category)
  select biz_a, o, i.name, i.unit, i.qty, i.minq, i.target, i.cat
  from unnest(array[o_bangi, o_kajang]) o,
  (values
    ('Tepung gandum', 'kg', 40, 20, 60, 'Bahan kering'),
    ('Minyak masak', 'botol', 3, 5, 12, 'Bahan kering'),      -- stok rendah
    ('Telur', 'papan', 0, 4, 10, 'Bahan segar'),             -- habis
    ('Majerin', 'kg', 8, 3, 10, 'Bahan segar'),
    ('Gas LPG', 'tong', 2, 1, 3, 'Lain-lain'),
    ('Bekas polisterin', 'pek', 15, 5, 20, 'Pembungkusan')
  ) i(name, unit, qty, minq, target, cat);

  insert into public.ingredient_costs (business_id, inventory_item_id, outlet_id, unit_price)
  select biz_a, id, outlet_id, case name when 'Tepung gandum' then 3.2 when 'Minyak masak' then 12 when 'Telur' then 13.5
                                         when 'Majerin' then 9 when 'Gas LPG' then 47.5 else 6 end
  from public.inventory_items where business_id = biz_a;

  insert into public.menu_items (id, business_id, outlet_id, name, selling_price, portions)
  values ('aaaaaaaa-0000-4000-8000-00000000c001', biz_a, o_bangi, 'Roti Canai Kosong', 1.5, 40);
  insert into public.menu_ingredients (business_id, menu_item_id, inventory_item_id, outlet_id, qty)
  select biz_a, 'aaaaaaaa-0000-4000-8000-00000000c001', id, outlet_id, q
  from public.inventory_items i join (values ('Tepung gandum', 2.0), ('Minyak masak', 0.3), ('Majerin', 0.5)) v(n, q) on v.n = i.name
  where i.outlet_id = o_bangi;

  -- Stok syarikat B (menyamar owner syarikat B)
  perform set_config('request.jwt.claims', json_build_object('sub', u_lain, 'role', 'authenticated')::text, true);
  insert into public.inventory_items (business_id, outlet_id, name, unit, current_qty, min_qty, target_qty)
  values (biz_b, o_lain, 'Barang syarikat lain', 'pcs', 10, 2, 20);

  perform set_config('request.jwt.claims', '', true);
end $$;

commit;
