# เจอปัญหาแบบนี้ทำยังไง

## เผลอ commit บน main

ยังไม่ได้ push — ย้าย commit ไป branch ใหม่ได้ครบ

```bash
git branch fix/my-work          # ทำเครื่องหมายไว้ตรงที่ยืนอยู่
git reset --hard origin/main    # ถอย main กลับ งานไม่หาย อยู่ใน branch แล้ว
git checkout fix/my-work
```

::: warning
`reset --hard` ลบสิ่งที่ยังไม่ commit ทิ้ง ให้ `git status` ว่างก่อนพิมพ์บรรทัดนั้น
:::

## PR ขึ้นว่า "This branch is out-of-date"

มีคนรวมงานเข้า `main` หลังคุณแตก branch

```bash
git checkout main && git pull origin main
git checkout <branch ของคุณ>
git merge main                  # แก้ conflict ถ้ามี แล้ว commit
git push
```

## Merge conflict

git จะเขียนเครื่องหมายไว้ในไฟล์แบบนี้

```
<<<<<<< HEAD
บรรทัดที่มีอยู่ใน main
=======
บรรทัดที่คุณเขียน
>>>>>>> ui/news-card-spacing
```

เปิดไฟล์ ตัดสินใจว่าจะเอาแบบไหน (หรือผสม) **ลบทั้งสามบรรทัดเครื่องหมายออกให้หมด** แล้ว `git add <ไฟล์>` และ `git commit`

`git status` จะบอกว่าเหลือไฟล์ไหนยังไม่แก้

## CI แดง แต่บนเครื่องเขียว

เกือบทุกครั้งคือสองอย่างนี้

- **Node คนละรุ่น** — `node -v` ต้องเป็น 22 ขึ้นไป
- **ลืม `git add` ไฟล์ใหม่** — `git status` แล้วดูใต้หัวข้อ *Untracked files*

## เว็บทดลองไม่ขึ้น

- ยังสร้างไม่เสร็จ — รออีกสองสามนาที
- คุณใช้ fork — fork ไม่ได้เว็บทดลอง ตามการออกแบบของ GitHub ให้แนบภาพหน้าจอใน pull request แทน
- build พัง — ดูที่ check ชื่อ *build* ในหน้า pull request

## หน้าเว็บโหลดขึ้นแต่ปุ่มไม่ทำงาน

เมนูเปิดได้ หน้าตาปกติ แต่กดอะไรก็ไม่มีอะไรเกิดขึ้น — อาการนี้แปลว่าไฟล์ JavaScript หลักโหลดไม่สำเร็จ เปิด Console ใน browser (`F12`) แล้วดูบรรทัดสีแดง

## ยังติดอยู่

- ทักในดิสคอร์ด หรือเปิด **draft pull request** แล้วใส่ `[help]` ในหัวข้อ
- ถ้างานแตะไฟล์ในรายการ "ต้องถามก่อน" ([แก้อะไรได้บ้าง](/contributing)) ให้เขียนย่อหน้าเดียวใน pull request ว่าจะทำอะไรและทำไม **ก่อน** เขียนโค้ด เร็วกว่าเขียนเสร็จแล้วมารื้อ
