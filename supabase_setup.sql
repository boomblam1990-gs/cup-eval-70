-- =====================================================================
--  ระบบประเมินผลการดำเนินงาน คปสอ. ปีงบประมาณ 2570  (Supabase schema)
--  วิธีใช้: เปิด Supabase > SQL Editor > New query > วางทั้งไฟล์นี้ > Run
--  (รันซ้ำได้ ไม่ทำข้อมูลเดิมพัง — ใช้ if not exists / on conflict)
-- =====================================================================

-- ---------- ตาราง ----------
create table if not exists public.groups (
  id            int primary key,
  name          text not null,
  coordinator   text,            -- ชื่อผู้ประสานงานหลัก
  central_email text,            -- เมลล์กลางของกลุ่มงาน
  topics_locked boolean not null default false  -- admin ล็อกไม่ให้แก้ประเด็น
);

create table if not exists public.profiles (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  role     text not null default 'group',   -- 'admin' | 'group'
  group_id int references public.groups(id)
);

create table if not exists public.topics (
  id            bigserial primary key,
  group_id      int not null references public.groups(id) on delete cascade,
  name          text not null,              -- ชื่อประเด็น/งานย่อย
  category      text,                       -- ประเภทงาน (งานประจำ/นโยบาย/อื่นๆ)
  resp_name     text,                       -- ผู้รับผิดชอบ: ชื่อ
  resp_position text,                       -- ผู้รับผิดชอบ: ตำแหน่ง
  created_at    timestamptz not null default now()
);
create index if not exists topics_group_idx on public.topics(group_id);

-- คะแนน PDCA 1 แถว = 1 ประเด็น x 1 อำเภอ ; p,d,c,a,r = 5 องค์ประกอบ (1-5)
create table if not exists public.scores (
  id       bigserial primary key,
  topic_id bigint not null references public.topics(id) on delete cascade,
  dno      int not null check (dno between 1 and 9),  -- ลำดับอำเภอ 1-9
  p int check (p between 1 and 5),   -- Plan
  d int check (d between 1 and 5),   -- Do
  c int check (c between 1 and 5),   -- Check
  a int check (a between 1 and 5),   -- Act
  r int check (r between 1 and 5),   -- Results
  unique (topic_id, dno)
);

-- KPI 60% : admin กรอกร้อยละผ่านเกณฑ์ของแต่ละอำเภอ
create table if not exists public.kpi_scores (
  dno     int primary key check (dno between 1 and 9),
  percent numeric check (percent >= 0 and percent <= 100)
);

-- ค่าตั้งค่าระบบ (แถวเดียว)
create table if not exists public.settings (
  id       int primary key default 1,
  weight1  numeric not null default 60,   -- น้ำหนักส่วนที่ 1 (KPI)
  weight2  numeric not null default 40,   -- น้ำหนักส่วนที่ 2 (PDCA)
  year     text not null default '2570',
  constraint one_row check (id = 1)
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------- ฟังก์ชันช่วย (security definer กัน RLS วนซ้ำ) ----------
create or replace function public.my_role() returns text
language sql security definer stable set search_path = public as $$
  select role from public.profiles where user_id = auth.uid()
$$;

create or replace function public.my_group() returns int
language sql security definer stable set search_path = public as $$
  select group_id from public.profiles where user_id = auth.uid()
$$;

-- กันไม่ให้กลุ่ม (ที่ไม่ใช่ admin) แก้ชื่อกลุ่มหรือปลดล็อกเอง
create or replace function public.guard_group_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' then
    if new.topics_locked is distinct from old.topics_locked
       or new.name is distinct from old.name
       or new.id is distinct from old.id then
      raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ส่วนนี้ได้';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_group on public.groups;
create trigger trg_guard_group before update on public.groups
  for each row execute function public.guard_group_update();

-- ---------- เปิด RLS ----------
alter table public.groups     enable row level security;
alter table public.profiles   enable row level security;
alter table public.topics     enable row level security;
alter table public.scores     enable row level security;
alter table public.kpi_scores enable row level security;
alter table public.settings   enable row level security;

-- profiles: เห็นของตัวเอง / admin เห็นทั้งหมด
drop policy if exists p_profiles_sel on public.profiles;
create policy p_profiles_sel on public.profiles for select
  using (user_id = auth.uid() or public.my_role() = 'admin');

-- groups: กลุ่มเห็นเฉพาะของตน / admin ทั้งหมด ; แก้ของตนได้ (ยกเว้นล็อก/ชื่อ) / admin ทั้งหมด
drop policy if exists p_groups_sel on public.groups;
create policy p_groups_sel on public.groups for select
  using (id = public.my_group() or public.my_role() = 'admin');
drop policy if exists p_groups_upd on public.groups;
create policy p_groups_upd on public.groups for update
  using (id = public.my_group() or public.my_role() = 'admin')
  with check (id = public.my_group() or public.my_role() = 'admin');

-- topics: กลุ่มจัดการเฉพาะของตน และเฉพาะตอนยังไม่ล็อก / admin ทั้งหมด
drop policy if exists p_topics_sel on public.topics;
create policy p_topics_sel on public.topics for select
  using (group_id = public.my_group() or public.my_role() = 'admin');
drop policy if exists p_topics_ins on public.topics;
create policy p_topics_ins on public.topics for insert
  with check (
    public.my_role() = 'admin'
    or (group_id = public.my_group()
        and not (select topics_locked from public.groups g where g.id = group_id))
  );
drop policy if exists p_topics_upd on public.topics;
create policy p_topics_upd on public.topics for update
  using (
    public.my_role() = 'admin'
    or (group_id = public.my_group()
        and not (select topics_locked from public.groups g where g.id = group_id))
  );
drop policy if exists p_topics_del on public.topics;
create policy p_topics_del on public.topics for delete
  using (
    public.my_role() = 'admin'
    or (group_id = public.my_group()
        and not (select topics_locked from public.groups g where g.id = group_id))
  );

-- scores: ผูกกับประเด็นของกลุ่มตน / admin ทั้งหมด
drop policy if exists p_scores_sel on public.scores;
create policy p_scores_sel on public.scores for select
  using (
    public.my_role() = 'admin'
    or exists (select 1 from public.topics t
               where t.id = topic_id and t.group_id = public.my_group())
  );
drop policy if exists p_scores_ins on public.scores;
create policy p_scores_ins on public.scores for insert
  with check (
    public.my_role() = 'admin'
    or exists (select 1 from public.topics t
               where t.id = topic_id and t.group_id = public.my_group())
  );
drop policy if exists p_scores_upd on public.scores;
create policy p_scores_upd on public.scores for update
  using (
    public.my_role() = 'admin'
    or exists (select 1 from public.topics t
               where t.id = topic_id and t.group_id = public.my_group())
  );

-- kpi_scores: เฉพาะ admin
drop policy if exists p_kpi_all on public.kpi_scores;
create policy p_kpi_all on public.kpi_scores for all
  using (public.my_role() = 'admin')
  with check (public.my_role() = 'admin');

-- settings: ทุกคนที่ล็อกอินอ่านได้ / admin แก้ได้
drop policy if exists p_set_sel on public.settings;
create policy p_set_sel on public.settings for select using (auth.uid() is not null);
drop policy if exists p_set_upd on public.settings;
create policy p_set_upd on public.settings for update
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- ---------- Seed 15 กลุ่มงาน (แก้ชื่อได้ภายหลัง) ----------
insert into public.groups (id, name) values
 (1 ,'กลุ่มงานพัฒนายุทธศาสตร์สาธารณสุข'),
 (2 ,'กลุ่มงานส่งเสริมสุขภาพ'),
 (3 ,'กลุ่มงานควบคุมโรคติดต่อ'),
 (4 ,'กลุ่มงานโรคไม่ติดต่อ'),
 (5 ,'กลุ่มงานอนามัยสิ่งแวดล้อมและอาชีวอนามัย'),
 (6 ,'กลุ่มงานคุ้มครองผู้บริโภคและเภสัชสาธารณสุข'),
 (7 ,'กลุ่มงานทันตสาธารณสุข'),
 (8 ,'กลุ่มงานประกันสุขภาพ'),
 (9 ,'กลุ่มงานพัฒนาคุณภาพและรูปแบบบริการ'),
 (10,'กลุ่มงานบริหารทรัพยากรบุคคล'),
 (11,'กลุ่มงานนิติการ'),
 (12,'กลุ่มงานบริหารทั่วไป'),
 (13,'กลุ่มงานภูมิปัญญาท้องถิ่นด้านสุขภาพ'),
 (14,'กลุ่มงานสุขภาพดิจิทัล'),
 (15,'กลุ่มงานการแพทย์แผนไทยและการแพทย์ทางเลือก')
on conflict (id) do nothing;

-- =====================================================================
--  สร้างบัญชีผู้ใช้ (ทำหลังรัน schema ข้างบนแล้ว)
--  1) Authentication > Users > Add user  (ติ๊ก Auto Confirm User)
--     - แอดมิน:  email = admin@cup.local         , ตั้งรหัสผ่าน
--     - กลุ่ม 1: email = group1@cup.local         , ตั้งรหัสผ่าน
--     - กลุ่ม 2: email = group2@cup.local  ... จนถึง group15@cup.local
--     (ชื่อผู้ใช้ที่แจกให้กลุ่ม = group1..group15 / admin ; โดเมน @cup.local
--      ต้องตรงกับ LOGIN_DOMAIN ใน config.js)
--  2) จากนั้นรัน SQL ด้านล่างนี้ เพื่อผูกบัญชีเข้ากับกลุ่ม/บทบาท
-- =====================================================================
insert into public.profiles (user_id, role, group_id)
select u.id, 'group', g.id
from auth.users u
join public.groups g on u.email = 'group' || g.id || '@cup.local'
on conflict (user_id) do update set role = excluded.role, group_id = excluded.group_id;

insert into public.profiles (user_id, role, group_id)
select u.id, 'admin', null
from auth.users u
where u.email = 'admin@cup.local'
on conflict (user_id) do update set role = excluded.role, group_id = excluded.group_id;
