-- =====================================================================
-- BizProfit Pro · Fasa 17: Daftar sendiri & jemput staf
--
--  1. setup_business(nama syarikat, nama outlet)
--     Pengguna baru (sudah login, belum ada profil) cipta syarikat SENDIRI:
--     syarikat baru (trial Pro ikut nilai lalai), outlet pertama, profil OWNER,
--     kategori & kaedah bayaran asal. Tak boleh masuk syarikat orang lain.
--
--  2. Jemputan staf (pautan dikongsi, contohnya melalui WhatsApp)
--     staff_invites: owner jemput admin/manager/staff ke mana-mana outlet syarikatnya;
--     admin jemput manager/staff ke outlet sendiri. Role & outlet ditetapkan oleh
--     yang menjemput, BUKAN oleh orang yang daftar. Token rawak, sekali guna, 7 hari.
--     invite_info(token)   -> maklumat ringkas untuk skrin log masuk (tanpa login)
--     accept_invite(token) -> pengguna login tanpa profil menjadi ahli syarikat
--     Had akaun staf ikut pakej masih dikuatkuasa (trigger Fasa 12).
--
--  3. list_members() / remove_member(user)
--     Senarai akaun pengguna syarikat (dengan e-mel) dan buang akses.
--
-- Asalnya dinamakan fasa15 dalam PR #25 (belum pernah dijalankan); dinamakan semula Fasa 17.
-- Seluruh skrip satu transaksi: kalau satu langkah gagal, tiada apa berubah.
-- =====================================================================
begin;

-- 1. Daftar sendiri ---------------------------------------------------------
create function public.setup_business(p_business text, p_outlet text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b uuid; o uuid;
begin
  if uid is null then raise exception 'Log masuk diperlukan'; end if;
  if exists (select 1 from public.staff_profiles where user_id = uid) then
    raise exception 'Akaun ini sudah ada syarikat';
  end if;
  p_business := btrim(coalesce(p_business, '')); p_outlet := btrim(coalesce(p_outlet, ''));
  if length(p_business) not between 1 and 120 then raise exception 'Nama syarikat tidak sah'; end if;
  if length(p_outlet) not between 1 and 80 then raise exception 'Nama outlet tidak sah'; end if;

  insert into public.businesses (name) values (p_business) returning id into b;   -- plan 'free' + trial lalai
  insert into public.outlets (business_id, name) values (b, p_outlet) returning id into o;
  insert into public.staff_profiles (user_id, outlet_id, role, business_id) values (uid, o, 'owner', b);

  insert into public.categories (business_id, key, name, type, counts_in_profit, is_sales) values
    (b, 'IN01', 'Shop Sales', 'In', true, true),
    (b, 'IN02', 'Orders & Catering', 'In', true, true),
    (b, 'IN03', 'Delivery Apps (Grab, Foodpanda)', 'In', true, true),
    (b, 'IN04', 'Other Income', 'In', true, false),
    (b, 'IN05', 'Owner Money Added', 'In', false, false),
    (b, 'IN06', 'Loan Received', 'In', false, false),
    (b, 'OUT01', 'Ingredients', 'Out', true, false),
    (b, 'OUT02', 'LPG Gas', 'Out', true, false),
    (b, 'OUT03', 'Packaging', 'Out', true, false),
    (b, 'OUT04', 'Shop Rent', 'Out', true, false),
    (b, 'OUT05', 'Electricity, Water & Internet', 'Out', true, false),
    (b, 'OUT06', 'Staff Wages', 'Out', true, false),
    (b, 'OUT07', 'EPF, SOCSO & EIS', 'Out', true, false),
    (b, 'OUT08', 'Bank & E-wallet Fees', 'Out', true, false),
    (b, 'OUT09', 'Transport', 'Out', true, false),
    (b, 'OUT10', 'Marketing & Ads', 'Out', true, false),
    (b, 'OUT11', 'Cleaning', 'Out', true, false),
    (b, 'OUT12', 'Repairs & Maintenance', 'Out', true, false),
    (b, 'OUT13', 'Small Equipment', 'Out', true, false),
    (b, 'OUT14', 'Licences, Permits & Insurance', 'Out', true, false),
    (b, 'OUT15', 'Loan Interest', 'Out', true, false),
    (b, 'OUT16', 'Other Business Costs', 'Out', true, false),
    (b, 'OUT17', 'Owner Money Taken', 'Out', false, false),
    (b, 'OUT18', 'Loan Amount Repaid', 'Out', false, false),
    (b, 'OUT19', 'Income Tax Paid', 'Out', false, false),
    (b, 'OUT20', 'Asset & Equipment Purchase', 'Out', false, false);
  insert into public.payment_methods (business_id, name) values
    (b, 'Cash'), (b, 'DuitNow QR'), (b, 'Card'), (b, 'E-wallet'), (b, 'Bank Transfer'), (b, 'Other');
  return b;
end $$;
revoke execute on function public.setup_business(text, text) from public, anon;
grant execute on function public.setup_business(text, text) to authenticated;

-- 2. Jemputan ---------------------------------------------------------------
create table public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null default public.current_business_id() references public.businesses(id),
  outlet_id uuid not null,
  role text not null check (role in ('admin', 'manager', 'staff')),
  label text check (label is null or length(label) <= 80),           -- nota: nama orang yang dijemput
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid,
  used_at timestamptz,
  constraint staff_invites_outlet_fk foreign key (business_id, outlet_id) references public.outlets (business_id, id) on delete cascade
);
create index idx_staff_invites_business on public.staff_invites (business_id);
alter table public.staff_invites enable row level security;
revoke all on public.staff_invites from anon, authenticated;
grant select, insert, delete on public.staff_invites to authenticated;

create policy tenant_isolation on public.staff_invites as restrictive for all to authenticated
  using (business_id = (select public.current_business_id()))
  with check (business_id = (select public.current_business_id()));
-- Owner: semua jemputan syarikat. Admin: jemputan outlet sendiri sahaja.
create policy "baca jemputan" on public.staff_invites for select to authenticated
  using ((select public.can_admin_outlet(outlet_id)));
create policy "cipta jemputan" on public.staff_invites for insert to authenticated
  with check ((select public.can_admin_outlet(outlet_id))
              and (role in ('manager', 'staff') or (role = 'admin' and (select public.is_owner())))
              and created_by = auth.uid() and used_by is null and used_at is null
              and expires_at <= now() + interval '8 days');
create policy "batal jemputan" on public.staff_invites for delete to authenticated
  using ((select public.can_admin_outlet(outlet_id)) and used_at is null);

-- Maklumat jemputan untuk skrin log masuk (boleh dipanggil tanpa login; token ialah rahsia).
create function public.invite_info(p_token text)
returns table (business text, outlet text, role text, valid boolean)
language sql stable security definer set search_path = '' as $$
  select b.name, o.name, i.role, (i.used_at is null and i.expires_at > now())
    from public.staff_invites i
    join public.businesses b on b.id = i.business_id
    join public.outlets o on o.id = i.outlet_id
   where i.token = p_token
$$;
revoke execute on function public.invite_info(text) from public;
grant execute on function public.invite_info(text) to anon, authenticated;

create function public.accept_invite(p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); inv public.staff_invites; bname text;
begin
  if uid is null then raise exception 'Log masuk diperlukan'; end if;
  if exists (select 1 from public.staff_profiles where user_id = uid) then
    raise exception 'Akaun ini sudah ada syarikat. Guna e-mel lain untuk terima jemputan ini.';
  end if;
  select * into inv from public.staff_invites where token = p_token for update;
  if not found then raise exception 'Jemputan tidak sah'; end if;
  if inv.used_at is not null then raise exception 'Jemputan ini sudah digunakan'; end if;
  if inv.expires_at <= now() then raise exception 'Jemputan ini sudah tamat tempoh'; end if;

  insert into public.staff_profiles (user_id, outlet_id, role, business_id)
    values (uid, inv.outlet_id, inv.role, inv.business_id);     -- trigger Fasa 12 semak had akaun staf
  update public.staff_invites set used_by = uid, used_at = now() where id = inv.id;
  select name into bname from public.businesses where id = inv.business_id;
  return bname;
end $$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- 3. Ahli syarikat ------------------------------------------------------------
-- Owner: semua akaun syarikat. Admin: akaun outlet sendiri.
create function public.list_members()
returns table (user_id uuid, email text, role text, outlet_id uuid, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select sp.user_id, u.email::text, sp.role, sp.outlet_id, sp.created_at, u.last_sign_in_at
    from public.staff_profiles sp
    join auth.users u on u.id = sp.user_id
   where sp.business_id = public.current_business_id()
     and public.can_admin_outlet(sp.outlet_id)
   order by case sp.role when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end, u.email
$$;
revoke execute on function public.list_members() from public, anon;
grant execute on function public.list_members() to authenticated;

-- Buang akses: owner buang sesiapa kecuali owner; admin buang manager/staff outlet sendiri.
-- Akaun log masuk tidak dipadam; rekod lama (transaksi, log audit) kekal.
create function public.remove_member(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare sp public.staff_profiles;
begin
  select * into sp from public.staff_profiles where user_id = p_user and business_id = public.current_business_id();
  if not found then raise exception 'Akaun tidak dijumpai'; end if;
  if p_user = auth.uid() then raise exception 'Tak boleh buang akaun sendiri'; end if;
  if sp.role = 'owner' then raise exception 'Akaun owner tak boleh dibuang'; end if;
  if not public.can_admin_outlet(sp.outlet_id) then raise exception 'Tiada akses'; end if;
  if sp.role = 'admin' and not public.is_owner() then raise exception 'Hanya owner boleh buang admin'; end if;
  delete from public.staff_profiles where user_id = p_user;
end $$;
revoke execute on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;

commit;
