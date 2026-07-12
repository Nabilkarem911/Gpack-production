'use strict';
const db = require('./db');

(async () => {
    try {
        // ── 10 Standard Terms ──
        const terms = [
            ['مدة التوريد', 'مدة التوريد 30 يوم عمل من تاريخ اعتماد التصميم النهائي وتحويل الدفعة المقدمة.'],
            ['الدفعة المقدمة', 'يتم تحصيل 50% من قيمة العقد كدفعة مقدمة قبل البدء في الإنتاج.'],
            ['الكميات التقريبية', 'الكميات المدونة بالاتفاقية تقريبية وقد تزيد أو تنقص بنسبة 5% حسب طبيعة الإنتاج.'],
            ['ضمان الجودة', 'يضمن المصنع جودة المنتجات المسلمة وخلوها من العيوب المصنعية لمدة 6 أشهر من تاريخ التسليم.'],
            ['شروط الإلغاء', 'في حال إلغاء الطلب بعد بدء الإنتاج يتحمل العميل تكاليف المواد الخام المستخدمة.'],
            ['التسليم', 'يتم التسليم في موقع العميل المحدد مسبقاً وتتحمل الشركة تكاليف الشحن داخل المنطقة.'],
            ['مواصفات الطباعة', 'يتم اعتماد التصميم النهائي من العميل قبل البدء في الطباعة ولا يتحمل المصنع أي تعديلات بعد الاعتماد.'],
            ['سريان العرض', 'هذا العرض ساري المفعول لمدة 15 يوماً من تاريخ الإصدار.'],
            ['الفحص والاستلام', 'يحق للعميل فحص البضاعة خلال 48 ساعة من التسليم وإبداء أي ملاحظات.'],
            ['القوة القاهرة', 'لا يتحمل المصنع أي تأخير ناتج عن ظروف قاهرة كالكوارث الطبيعية أو القرارات الحكومية.']
        ];

        for (const [title, content] of terms) {
            await db.query(
                `INSERT INTO standard_terms (title, content, is_default, is_active)
                 VALUES ($1, $2, true, true)
                 ON CONFLICT DO NOTHING`,
                [title, content]
            );
        }
        console.log('Inserted 10 terms');

        // ── 10 Products with Variants ──
        const products = [
            { name: 'كرتون موج', sku: 'CRT-001', variants: [{ s: '30×40 سم', p: 140 }, { s: '40×50 سم', p: 180 }, { s: '50×60 سم', p: 220 }] },
            { name: 'أكواب ورقية', sku: 'CUP-001', variants: [{ s: '4 أونز', p: 85 }, { s: '8 أونز', p: 120 }, { s: '12 أونز', p: 155 }] },
            { name: 'أكياس تغليف', sku: 'BAG-001', variants: [{ s: 'صغير 20×30', p: 45 }, { s: 'وسط 30×40', p: 65 }, { s: 'كبير 40×50', p: 90 }] },
            { name: 'صناديق هدايا', sku: 'GFT-001', variants: [{ s: 'صغير', p: 250 }, { s: 'وسط', p: 350 }, { s: 'كبير', p: 500 }] },
            { name: 'أغلفة شرنك', sku: 'SHR-001', variants: [{ s: '30 سم عرض', p: 75 }, { s: '50 سم عرض', p: 110 }] },
            { name: 'ملصقات طباعية', sku: 'LBL-001', variants: [{ s: '5×3 سم', p: 35 }, { s: '10×5 سم', p: 55 }, { s: '15×10 سم', p: 85 }] },
            { name: 'أطباق فوم', sku: 'FOM-001', variants: [{ s: 'رقم 3', p: 60 }, { s: 'رقم 5', p: 80 }, { s: 'رقم 9', p: 110 }] },
            { name: 'شنط ورقية', sku: 'PBG-001', variants: [{ s: 'صغير', p: 95 }, { s: 'وسط', p: 135 }, { s: 'كبير', p: 185 }] },
            { name: 'رول تغليف', sku: 'ROL-001', variants: [{ s: '30 سم', p: 120 }, { s: '45 سم', p: 160 }] },
            { name: 'علب طعام', sku: 'FBX-001', variants: [{ s: '500 مل', p: 70 }, { s: '750 مل', p: 95 }, { s: '1000 مل', p: 125 }] },
        ];

        // Get admin user ID for created_by
        const adminRes = await db.query(`SELECT id FROM users WHERE email = 'admin@gpack.com' LIMIT 1`);
        const adminId = adminRes.rows[0]?.id || null;

        for (const prod of products) {
            const pRes = await db.query(
                `INSERT INTO products (name, sku, status, created_by)
                 VALUES ($1, $2, 'active', $3)
                 ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name
                 RETURNING id`,
                [prod.name, prod.sku, adminId]
            );
            const pid = pRes.rows[0].id;

            for (const v of prod.variants) {
                const vsku = prod.sku + '-' + v.s.replace(/\s+/g, '');
                await db.query(
                    `INSERT INTO product_variants (product_id, size_name, sku, selling_price, status)
                     VALUES ($1, $2, $3, $4, 'active')
                     ON CONFLICT (sku) DO UPDATE SET size_name = EXCLUDED.size_name, selling_price = EXCLUDED.selling_price`,
                    [pid, v.s, vsku, v.p]
                );
            }
        }
        console.log('Inserted 10 products with variants');

        process.exit(0);
    } catch (e) {
        console.error('Seed error:', e);
        process.exit(1);
    }
})();
