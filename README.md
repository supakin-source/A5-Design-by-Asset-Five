# A5 Design by Asset Five — LINE OA Chatbot

แชทบอท LINE Official Account สำหรับ **A5 Design by Asset Five** (บริษัทรับออกแบบและ
ก่อสร้างแบบ turn-key) ทำหน้าที่รับลูกค้าตลอด 24 ชม. โดยมีเป้าหมาย 2 ข้อ:

1. **สนทนากับลูกค้าและส่งต่อข้อมูลให้ผู้รับผิดชอบ** — บอทเก็บข้อมูลสำคัญ (ชื่อ,
   เบอร์ติดต่อ, ประเภทงาน, งบประมาณ, ทำเล, กรอบเวลา) แล้วแจ้งเตือนเข้ากลุ่ม LINE
   ของทีมงานพร้อมบันทึกลงฐานข้อมูล เพื่อให้ทีมงานติดต่อกลับได้ต่อเนื่อง
2. **แปลงบทสนทนาเป็น market data** — จัดหมวดหัวข้อที่ลูกค้าถาม ความรู้สึกในบทสนทนา
   ประเภทงาน/งบประมาณ/ทำเลที่ลูกค้าสนใจ แสดงเป็น dashboard สำหรับใช้ปรับปรุงบริการ
   และวางกลยุทธ์การตลาด

บอทถูกออกแบบให้ทำหน้าที่เหมือน **พนักงานต้อนรับ/คัดกรองเบื้องต้น** (คล้ายพยาบาลที่
ซักอาการก่อนส่งพบแพทย์) ไม่ใช่ผู้เชี่ยวชาญที่ตัดสินใจแทนบริษัท — รายละเอียดขอบเขต
และการควบคุมความเสี่ยงอยู่ใน [`docs/AI_POLICY.md`](docs/AI_POLICY.md) **กรุณาอ่าน
เอกสารนี้ก่อนเปิดใช้งานจริง**

## สถาปัตยกรรม

```
ลูกค้า (LINE) ──► LINE Messaging API ──► /api/line/webhook (Next.js บน Vercel)
                                              │
                          ┌───────────────────┼────────────────────┐
                          ▼                   ▼                    ▼
                 Gemini (ข้อความ+รูป)   Postgres (lead/       LINE push
                 ตอบ + สกัดข้อมูล        บทสนทนา/market data)  แจ้งทีมงาน
                                              │
                                              ▼
                                    /dashboard (ทีมงานภายใน)
```

- **Next.js 16 (App Router) + TypeScript** — รวม webhook และ dashboard ในโปรเจกต์เดียว
  deploy บน Vercel ได้ฟรี
- **Google Gemini** (`gemini-2.0-flash` โดยค่าเริ่มต้น) — รองรับทั้งข้อความและรูปภาพ
  (อ่านข้อความในรูป/สรุปภาพหน้างาน) ในคำขอเดียว ไม่ต้องต่อ OCR แยก และมี free tier
  ที่เพียงพอกับปริมาณลูกค้าระดับไม่เกิน ~20 คน/วัน
- **Prisma + PostgreSQL** — เก็บ lead, บทสนทนา และข้อมูลเชิงหมวดหมู่สำหรับวิเคราะห์
- **Recharts** — กราฟในหน้า Market data

## ขั้นตอนติดตั้ง

### 1) เตรียม LINE Official Account

1. สร้าง Provider และ **Messaging API channel** ที่ https://developers.line.biz/console/

   > ⚠️ **สำคัญถ้าคิดจะใช้ LIFF ในอนาคต**: ให้สร้าง channel ทุกตัวของโปรเจกต์นี้ไว้ใต้
   > **Provider เดียวกัน** เพราะ LIFF ต้องอยู่ใต้ LINE Login channel แยกอีกตัว และจะ
   > เชื่อมกับ LINE OA (Linked LINE Official Account) ได้เฉพาะเมื่ออยู่ Provider เดียวกัน
   > — ถ้าสร้างคนละ Provider ภายหลังย้ายไม่ได้ ต้องสร้างใหม่ทั้งชุด

2. ในแท็บ **Messaging API** กด Issue สำหรับ `Channel access token` (long-lived)
3. ในแท็บ **Basic settings** คัดลอก `Channel secret`
4. ปิด **Auto-reply messages** และ **Greeting messages** ของ LINE OA
   (ที่ https://manager.line.biz) เพื่อไม่ให้ตอบซ้อนกับบอท

> 🛑 **ยังไม่ต้องตั้งค่า Webhook ในขั้นตอนนี้** — ช่อง "ลิงก์ Webhook" ต้องใช้ URL ของ
> ระบบที่ deploy แล้ว ซึ่งจะได้ในขั้นตอนที่ 6 ให้ปล่อยว่างไว้ก่อนแล้วกลับมาทำทีหลัง
> (จะตั้งจาก LINE Developers Console หรือจาก LINE OA Manager → การตั้งค่า →
> Messaging API ก็ได้ ทั้งสองที่คือค่าเดียวกัน)

### 2) ขอ Gemini API key

สร้าง API key ฟรีที่ https://aistudio.google.com/app/apikey (ตรวจสอบ rate limit ของ
free tier ให้สอดคล้องกับปริมาณลูกค้าที่คาดการณ์)

### 3) เตรียมฐานข้อมูล PostgreSQL

ใช้บริการที่มี free tier ได้ เช่น Neon (https://neon.tech) หรือ Supabase
(https://supabase.com) แล้วคัดลอก connection string มาใส่ `DATABASE_URL`

### 4) ตั้งค่า environment variables

คัดลอก `.env.example` เป็น `.env.local` แล้วกรอกค่าให้ครบ

| ตัวแปร | คำอธิบาย |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | Channel access token จาก LINE Developers |
| `LINE_CHANNEL_SECRET` | Channel secret (ใช้ตรวจลายเซ็น webhook) |
| `LINE_STAFF_NOTIFY_ID` | user ID หรือ group ID ที่จะรับแจ้งเตือนลูกค้าใหม่ |
| `GEMINI_API_KEY` | API key จาก Google AI Studio |
| `GEMINI_MODEL` | ค่าเริ่มต้น `gemini-2.0-flash` |
| `DATABASE_URL` | connection string ของ PostgreSQL |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | บัญชีเข้า dashboard ของทีมงาน |
| `SESSION_SECRET` | สตริงสุ่มยาว ๆ ใช้เซ็น session cookie |

> **การหา `LINE_STAFF_NOTIFY_ID` ของกลุ่ม**: เชิญ LINE OA เข้ากลุ่มของทีมงาน แล้วส่ง
> ข้อความในกลุ่มหนึ่งครั้ง จากนั้นดู log ของ webhook (Vercel → Logs) จะเห็น
> `source.groupId` ให้นำค่านั้นมาใส่ (ถ้าต้องการแจ้งเข้าบุคคล ให้ใช้ `source.userId`)

### 5) รันในเครื่อง

```bash
npm install
npx prisma migrate deploy   # หรือ npx prisma migrate dev ตอนพัฒนา
npm run db:seed             # (ไม่บังคับ) ใส่ข้อมูลตัวอย่างเพื่อดู dashboard
npm run dev                 # http://localhost:3000
```

### 6) Deploy บน Vercel และตั้ง webhook

1. Import repo นี้เข้า Vercel และใส่ environment variables ทั้งหมดข้างต้น

   > ตรวจว่า **Framework Preset** เป็น `Next.js` (ไม่ใช่ `Other`) ไม่งั้น build จะสำเร็จ
   > แต่ deploy fail ด้วยข้อความ `No Output Directory named "public" found`
   > โปรเจกต์มี `vercel.json` ระบุ `"framework": "nextjs"` ไว้แล้ว แต่ถ้าค่าใน
   > dashboard ถูกตั้งเป็น Other ไว้ก่อนหน้า ให้แก้ที่ Settings → Build and Deployment
2. กด Deploy — สคริปต์ `build` จะรัน `prisma migrate deploy` ให้อัตโนมัติ จึงสร้าง
   ตารางในฐานข้อมูลเองโดยไม่ต้องรันคำสั่งในเครื่อง (ถ้าต้องการรันมือ ใช้
   `npx prisma migrate deploy` โดยตั้ง `DATABASE_URL` ของ production)

   > หมายเหตุ: preview deployment ของ Vercel ก็จะรัน migration กับฐานข้อมูลที่ตั้งไว้
   > ใน env เดียวกัน ถ้าในอนาคตต้องการแยกฐานข้อมูล production/preview ให้ตั้งค่า
   > `DATABASE_URL` แยกตาม environment ใน Vercel
3. กลับไปที่การตั้งค่า LINE (ขั้นตอนที่ 1) นำ URL
   `https://<โดเมนของคุณ>/api/line/webhook` ใส่ในช่อง **Webhook URL / ลิงก์ Webhook**
   → บันทึก → เปิด **Use webhook** ให้เป็น ON → กด **Verify**

   ต้องใส่ `LINE_CHANNEL_SECRET` ใน Vercel ให้ถูกต้องก่อนกด Verify เพราะ LINE จะส่ง
   request ที่มีลายเซ็นมาทดสอบ ถ้า secret ไม่ตรง ระบบจะตอบ 401 และ Verify จะไม่ผ่าน
   (เป็นการทำงานที่ถูกต้อง ไม่ใช่ข้อผิดพลาด)

## การใช้งาน dashboard

เข้า `/dashboard` (ต้องล็อกอินด้วย `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`)

- **ภาพรวม** — จำนวนลูกค้าทั้งหมด, รายใหม่ 7 วัน, จำนวนที่รอทีมงานติดต่อกลับ
- **รายชื่อลูกค้า** — ตารางลูกค้าพร้อมข้อมูลที่บอทเก็บได้ คลิกเพื่อดูบทสนทนาทั้งหมด
  และประวัติการแจ้งเตือนทีมงาน
- **Market data** — กราฟประเภทงาน/งบประมาณ/ทำเล, หัวข้อที่ลูกค้าถามบ่อย,
  ความรู้สึกในบทสนทนา และจำนวนลูกค้าใหม่รายวัน (ทุกกราฟสลับดูเป็นตารางได้)

## การปรับแต่งขอบเขตคำตอบของบอท

ฐานความรู้และกฎการตอบอยู่ที่ [`src/lib/policy.ts`](src/lib/policy.ts)

- เนื้อหาตั้งต้นเป็น **placeholder** ยังไม่ใช่ข้อมูลจริงของบริษัท ทีมงานฝ่ายธุรกิจ
  ต้องตรวจทานและเติมข้อมูลจริง (บริการ, พื้นที่ให้บริการ, ขั้นตอนการทำงาน, FAQ)
  ก่อนเปิดใช้งาน
- บอทถูกกำหนดให้ตอบได้เฉพาะสิ่งที่อยู่ในฐานความรู้นี้ หากไม่มีข้อมูลจะตอบว่ายังไม่มี
  ข้อมูลและส่งต่อทีมงาน — **ห้ามเสนอราคาหรือรับปากระยะเวลา/เงื่อนไขสัญญา**
- หากต้องการให้บอทตอบเรื่องใหม่ ให้เพิ่มเนื้อหาในฐานความรู้ ไม่ใช่แก้กฎให้ตอบได้
  ทุกอย่าง

## พฤติกรรมเมื่อระบบ AI ใช้งานไม่ได้

หาก Gemini ใช้โควตาหมดหรือขัดข้อง บอทจะไม่ปล่อยลูกค้าค้าง แต่จะตอบข้อความแจ้งว่า
ทีมงานจะติดต่อกลับ พร้อมส่งต่อเคสให้ทีมงานทันที (สถานะ `ai_unavailable`) และการ
แจ้งเตือนที่ส่งไม่สำเร็จจะถูกบันทึกไว้ให้เห็นใน dashboard ไม่หายไปเงียบ ๆ

## หมายเหตุด้าน PDPA

- ข้อความแรกที่บอทคุยกับลูกค้าใหม่จะแจ้งวัตถุประสงค์การเก็บข้อมูล และระบบบันทึก
  เวลาที่แจ้ง (`consentShownAt`)
- รูปภาพที่ลูกค้าส่งมาจะไม่ถูกเก็บเป็นไฟล์ในระบบ เก็บเพียงคำอธิบายสรุปที่จำเป็นต่อ
  การส่งต่องาน
- ผู้เข้าถึง dashboard ต้องรักษาความลับข้อมูลลูกค้าตามนโยบายบริษัทและ PDPA

## ทางขยายในอนาคต (Flex Message / Quick Reply / LIFF)

- **Quick Reply และ Flex Message** ใช้ Messaging API channel เดิมได้เลย ไม่ต้องสร้าง
  channel เพิ่ม — ชนิดข้อมูลใน [`src/lib/line.ts`](src/lib/line.ts) (`LineMessage`,
  `LineQuickReply`, `LineAction`) รองรับไว้แล้ว ส่งได้ผ่าน `replyMessage`/`pushMessage`
  เดิมโดยไม่ต้องแก้ตัวส่ง เหมาะกับปุ่มเลือกประเภทงาน/ช่วงงบประมาณ ซึ่งได้ข้อมูลแม่นยำ
  กว่าและช่วยประหยัดโควตา AI
- **Rich Menu** (เมนูค้างล่างหน้าแชท) ตั้งได้จาก LINE Manager โดยไม่ต้องเขียนโค้ด
- **LIFF** (เว็บฟอร์มในแอป LINE) ต้องสร้าง **LINE Login channel** เพิ่มใต้ Provider
  เดียวกัน แล้วลงทะเบียน LIFF app — เหมาะกับฟอร์มกรอกรายละเอียดโครงการแบบมีโครงสร้าง
  หรือจองนัดดูหน้างาน

## สิ่งที่ยังไม่ได้ทำ (ข้อเสนอถัดไป)

- ยังไม่มีปุ่ม/เมนู Quick Reply สำหรับเก็บข้อมูลแบบมีโครงสร้าง (ช่วยลดการใช้โควตา AI
  และเพิ่มความแม่นยำได้ หากปริมาณลูกค้าเพิ่มขึ้น)
- ยังไม่มีฟังก์ชันให้ทีมงานอัปเดตสถานะ/บันทึกโน้ตลูกค้าจาก dashboard (ตอนนี้อ่านได้
  เท่านั้น)
- ยังไม่มีการ export market data เป็น CSV/Excel และยังไม่มีระบบผู้ใช้หลายบัญชี
