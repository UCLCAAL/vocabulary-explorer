-- After 006 and 007. Seeds the public IDs already loaded into Fuseki.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('caal-generic-vocabulary-edit'));

CREATE TABLE IF NOT EXISTS vocab_workbench.reference_labels (
    vocabulary_code text NOT NULL,
    id text NOT NULL CHECK (id ~ '^[0-9]+$'),
    sort_order integer NOT NULL,
    canonical_value text NOT NULL,
    display_en text NOT NULL CHECK (btrim(display_en) <> ''),
    display_ru text, display_zh text, display_kk text, display_ky text, display_tg text, display_tk text, display_uz text,
    PRIMARY KEY (vocabulary_code,id)
);
INSERT INTO vocab_workbench.reference_labels
    (vocabulary_code,id,sort_order,canonical_value,display_en, display_ru, display_zh, display_kk, display_ky, display_tg, display_tk, display_uz) VALUES
    ('vernacular-building-functions', '001', '1', 'Abandoned', 'Abandoned', 'Заброшенное', '废弃', 'Қараусыз', 'Кароосуз калган/ташталган', 'Партофташуда', 'Terk edilen', 'Tashlandiq'),
    ('vernacular-building-functions', '002', '2', 'Administrative', 'Administrative', 'Административное', '行政', 'Әкімшілік', 'Админстративтик', 'Маъмурӣ', 'Administratiw', 'Ma''muriy'),
    ('vernacular-building-functions', '003', '3', 'Commercial', 'Commercial', 'Коммерческое', '商业', 'Коммерциялық', 'Комерциялык', 'Тиҷоратӣ', 'Söwda', 'Tadbirkorlik'),
    ('vernacular-building-functions', '004', '4', 'Cultural', 'Cultural', 'Культурное', '文化', 'Мәдени', 'Маданий', 'Фарҳангӣ', 'Medeni', 'Madaniy'),
    ('vernacular-building-functions', '005', '5', 'Educational', 'Educational', 'Образовательное', '教育', 'Білім беру', 'Билим беруу', 'Таълимӣ', 'Bilim', 'Ta''lim'),
    ('vernacular-building-functions', '006', '6', 'Handicraft', 'Handicraft', 'Ремесленное', '手工艺', 'Қолөнер', 'Кол онорчулук', 'Ҳунармандӣ', 'El işleri', 'Hunarmandchilik'),
    ('vernacular-building-functions', '007', '7', 'Health', 'Health', 'Медицинское', '医疗', 'Медициналық', 'Саламатттыкты сактоо', 'Саломатӣ', 'Saglyk', 'Kasalxona'),
    ('vernacular-building-functions', '008', '8', 'Hotel', 'Hotel', 'Гостиничное', '旅馆', 'Қонақүй', 'Мейманкана', 'Меҳмонхона', 'Myhmanhana', 'Mehmonxona'),
    ('vernacular-building-functions', '009', '9', 'Public', 'Public', 'Общественное', '公共', 'Қоғамдық', 'Коомдук', 'Ҷамъиятӣ', 'Jemgyýetçilik', 'Jamoat binosi'),
    ('vernacular-building-functions', '010', '10', 'Residential', 'Residential', 'Жилое', '居住', 'Тұрғын', 'Турак жай', 'Истиқоматӣ', 'Ýaşaýyş jaýy', 'Turarjoy'),
    ('vernacular-building-functions', '011', '11', 'Storage', 'Storage', 'Складское', '仓储', 'Қоймалық', 'Кампа', 'Анбор', 'Ammar', 'Ombor'),
    ('vernacular-building-materials', '001', '1', 'Adobe brick', 'Adobe brick', 'Саманный кирпич', '土坯砖', 'Саман кірпіш', 'Пахса, чийки кыш', 'Хишти хом', 'Çig kerpiç', 'Xom g‘isht'),
    ('vernacular-building-materials', '002', '2', 'Brick', 'Brick', 'Кирпич', '砖', 'Кірпіш', 'Кыш', 'Хишт', 'Kerpiç', 'G‘isht'),
    ('vernacular-building-materials', '003', '3', 'Burnt brick', 'Burnt brick', 'Обожжённый кирпич', '烧结砖', 'Күйдірілген кірпіш', 'Бышкан кыш', 'Хишти пухта', 'Bişen kerpiç', 'Pishiq g‘isht'),
    ('vernacular-building-materials', '004', '4', 'Burnt brick (with Nikalai building shape)', 'Burnt brick (with Nikalai building shape)', 'Обожжённый кирпич ("Николаевский")', '烧结砖(Nikolai 型建筑)', 'Күйдірілген кірпіш («Николаевский»)', 'Бышкан кыш (Николай формасындагы)', 'Хишти пухта (?)', 'Bişen kerpiç (Nikalaý binasynyň şekili bilen)', 'Pishiq g‘isht (Nikolay g‘isht)'),
    ('vernacular-building-materials', '005', '5', 'Burnt brick and mud block', 'Burnt brick and mud block', 'Обожжённый кирпич и глиноблок', '烧结砖与土坯块', 'Күйдірілген кірпіш және шикі блок', 'Бышкан кыш жана топурак жасалган блок', 'Хишти хом бо похса', 'Bişen  kerpiç we pagsa blok', 'Pishiq g‘isht va paxsa (loy blok?)'),
    ('vernacular-building-materials', '006', '6', 'Cinder block', 'Cinder block', 'Шлакоблок', '煤渣砌块', 'Шлакоблок', 'Шлактан жасалган блок', 'Блоки синдер', 'Şlak blok', 'Shlakli g‘isht'),
    ('vernacular-building-materials', '007', '7', 'Concrete', 'Concrete', 'Бетон', '混凝土', 'Бетон', 'Бетон', 'Семент', 'Beton', 'Beton'),
    ('vernacular-building-materials', '008', '8', 'Mud block', 'Mud block', 'Глиноблок (сырцовый блок)', '土坯块', 'Шикі блок', 'Топурактан жасалган блок (ылайдан жасалган блок)', 'Блоки хом', 'Pagsa blok', 'Paxsa (loy blok?)'),
    ('vernacular-building-materials', '009', '9', 'Mud brick', 'Mud brick', 'Кирпич-сырец', '土坯砖', 'Шикі кірпіш', 'Чийки кыш (ылайдан жасалган кыш)', 'Хишти хом', 'Palçyk kerpiç', 'Xom g‘isht'),
    ('vernacular-building-materials', '010', '10', 'Other', 'Other', 'Прочее', '其他', 'Басқа', 'Башка', 'Дигар', 'Başga', 'Boshqa'),
    ('vernacular-building-materials', '011', '11', 'Pakhsa', 'Pakhsa', 'Пахса', NULL, 'Пахса', NULL, NULL, NULL, NULL),
    ('vernacular-building-materials', '012', '12', 'Rammed earth', 'Rammed earth', 'Глинобит', NULL, 'Тапталған саз', NULL, NULL, NULL, NULL),
    ('vernacular-building-materials', '013', '13', 'Wood', 'Wood', 'Дерево', '木材', 'Ағаш', 'Жыгач', 'Чӯб', 'Agaç', 'Yog‘och'),
    ('vernacular-building-materials', '014', '14', 'Wooden frame', 'Wooden frame', 'Деревянный каркас', '木结构框架', 'Ағаш қаңқа', 'Жыгач каркас', 'Қолаби чӯбӣ', 'Agaç rama', 'Yog‘och sinchli'),
    ('vernacular-intervention-degrees', '001', '1', 'Major', 'Major', 'Крупный', '重大干预', 'Елеулі', 'Негизги/Маанилуу', 'Зиёд', 'Köp', 'Katta'),
    ('vernacular-intervention-degrees', '002', '2', 'Minor', 'Minor', 'Незначительный', '小型干预', 'Болмашы', 'Кошумча/Мааниси томон', 'Кам', 'Az', 'Kichik'),
    ('vernacular-intervention-degrees', '003', '3', 'None', 'None', 'Никакой', '无干预', 'Жоқ', 'Жок', 'Нест', 'Hiç hili', 'Yo‘q'),
    ('vernacular-intervention-degrees', '004', '4', 'Total', 'Total', 'Полный', '全面干预', 'Барлығы', 'Жалпы', 'Пурра', 'Doly', 'Jami'),
    ('vernacular-intervention-types', '001', '1', 'Abandoned', 'Abandoned', 'Заброшенное', '废弃', 'Қараусыз', 'Кароосуз калган/ ташталган', 'Партофташуда', 'Terk edilen', 'Tashlandiq'),
    ('vernacular-intervention-types', '002', '2', 'Adaptation', 'Adaptation', 'Адаптация', '适应性改造', 'Бейімдеу', 'Ылайыкташтыруу', 'Мутобиқшавӣ', 'Adaptasiýa', 'Moslashtirish'),
    ('vernacular-intervention-types', '003', '3', 'Conservation', 'Conservation', 'Сохранение', NULL, 'Консервация/Консервациялық жұмыстар', NULL, NULL, NULL, 'Asrab turish'),
    ('vernacular-intervention-types', '004', '4', 'Maintenance', 'Maintenance', 'Содержание', '维护', 'Күтім', 'Техникалык тейлоо/ кутуу', 'Нигоҳдорӣ', 'Hyzmat etme', 'Asrab turish'),
    ('vernacular-intervention-types', '005', '5', 'New work', 'New work', 'Новодел', '新建', 'Жаңа құрылыс', 'Жаны жумуш', 'Корҳои нав', 'Täze iş', 'Yangi qurilish'),
    ('vernacular-intervention-types', '006', '6', 'Preservation', 'Preservation', 'Сохранение', '保护', 'Сақтау', 'Сактоо/ Консервация', 'Муҳофизат', 'Gorap saklama', 'Saqlash'),
    ('vernacular-intervention-types', '007', '7', 'Reconstruction', 'Reconstruction', 'Реконструкция', '重建', 'Қайта құру', 'Кайра куруу', 'Барқарорсозӣ', 'Durky täzeleme', 'Tiklash'),
    ('vernacular-intervention-types', '008', '8', 'Repair', 'Repair', 'Ремонт', '修缮', 'Жөндеу', 'Ондоо', 'Таъмир', 'Bejeriş', 'Tuzatish / qayta qurish'),
    ('vernacular-intervention-types', '009', '9', 'Restoration', 'Restoration', 'Реставрация', '修复', 'Қалпына келтіру', 'Калыбына келтируу', 'Тармим', 'Restawrasiýa', 'Qayta tiklash'),
    ('vernacular-occupation-status', '001', '1', 'Fully occupied', 'Fully occupied', 'Полностью занято', '完全使用', 'Толық пайдалануда', 'Толук ээлеген (толугу менен жашашат)', 'Пурра ишғолшуда', 'Doly eýelenen', 'To‘liq foydalanilmoqda'),
    ('vernacular-occupation-status', '002', '2', 'Not occupied', 'Not occupied', 'Не занято', '未使用', 'Пайдаланылмайды', 'Ээленген эмес', 'Ишғолнашуда', 'Eýelenmedik', 'Foydalanilmaydi'),
    ('vernacular-occupation-status', '003', '3', 'Partially occupied', 'Partially occupied', 'Частично занято', '部分使用', 'Ішінара пайдалануда', 'Жарым жартылай ээленген.', 'Қисман ишғолшуда', 'Bölekleýin eýelenen', 'Qisman foydalaniladi'),
    ('vernacular-open-spaces', '001', '1', 'Courtyard', 'Courtyard', 'Двор', '院落', 'Аула', 'Ички короо', 'Ҳавлӣ', 'Howly', 'Hovli'),
    ('vernacular-open-spaces', '002', '2', 'Garden', 'Garden', 'Сад', '花园', 'Бақ', 'Бакча', 'Боғ', 'Bag', 'Bog‘'),
    ('vernacular-open-spaces', '003', '3', 'None', 'None', 'Ничего', '无', 'Жоқ', 'Жок', 'Не', 'Hiç zatsyz', 'Hech biri'),
    ('vernacular-open-spaces', '004', '4', 'Orchard', 'Orchard', 'Фруктовый сад', '果园', 'Жеміс бағы', 'Момо-жемиш багы', 'Боғи мева', 'Miweli bag', 'Mevali bog‘'),
    ('vernacular-open-spaces', '005', '5', 'Other', 'Other', 'Другой', '其他', 'Басқа', 'Башка', 'Дигар', 'Başga', 'Boshqa'),
    ('vernacular-open-spaces', '006', '6', 'Storage area', 'Storage area', 'Складское помещение', '储物区', 'Шаруашылық алаңы', 'Кампа аянты (сактоочу жай)', 'Анбор', 'Ammar', 'Saqlash joyi'),
    ('vernacular-roof-materials', '001', '1', 'Asbestos', 'Asbestos', 'Асбест', '石棉瓦', 'Асбест', 'Асбест (Шифер)', 'Азбест', 'Asbest', 'Azbest'),
    ('vernacular-roof-materials', '002', '2', 'Burnt brick', 'Burnt brick', 'Обожжённый кирпич', '烧结砖', 'Күйдірілген кірпіш', 'Бышкан кыш', 'Хишти хом', 'Bişen kerpiç', 'Pishiq g‘isht'),
    ('vernacular-roof-materials', '003', '3', 'Concrete', 'Concrete', 'Бетон', '混凝土', 'Бетон', 'Бетон', 'Бетон', 'Beton', 'Beton'),
    ('vernacular-roof-materials', '004', '4', 'Concrete slab', 'Concrete slab', 'Железобетонная плита', '混凝土板', 'Темірбетон плита', 'Бетон плитасы', 'Плитаи бетонӣ', 'Beton plita', 'Beton plita (Beton qoplama?)'),
    ('vernacular-roof-materials', '005', '5', 'Earthen', 'Earthen', 'Земляная', '土', 'Топырақ', 'Топурактуу (ылай)', 'Хокӣ', 'Toprak', 'Tuproqli'),
    ('vernacular-roof-materials', '006', '6', 'Other', 'Other', 'Прочее', '其他', 'Басқа', 'Башка', 'Дигар', 'Başga', 'Boshqa')
ON CONFLICT (vocabulary_code,id) DO NOTHING;

CREATE TABLE IF NOT EXISTS vocab_workbench.relation_type_concept_ids (
    id text PRIMARY KEY,
    relation_type_norm text NOT NULL UNIQUE
);
INSERT INTO vocab_workbench.relation_type_concept_ids(id,relation_type_norm) VALUES
    ('REL-001', 'associated with'),
    ('REL-002', 'contains / is contained within'),
    ('REL-003', 'cuts'),
    ('REL-004', 'is associated with'),
    ('REL-005', 'is created by / created'),
    ('REL-006', 'is part of'),
    ('REL-007', 'is referred to in / refers to'),
    ('REL-008', 'is related to'),
    ('REL-009', 'is represented by / represents'),
    ('REL-010', 'is superseded by / supersedes'),
    ('REL-011', 'same as'),
    ('REL-012', 'supersedes / is superseded by')
ON CONFLICT (id) DO NOTHING;

DO $verify$
BEGIN
    IF EXISTS (
        SELECT 1 FROM (VALUES
    ('REL-001', 'associated with'),
    ('REL-002', 'contains / is contained within'),
    ('REL-003', 'cuts'),
    ('REL-004', 'is associated with'),
    ('REL-005', 'is created by / created'),
    ('REL-006', 'is part of'),
    ('REL-007', 'is referred to in / refers to'),
    ('REL-008', 'is related to'),
    ('REL-009', 'is represented by / represents'),
    ('REL-010', 'is superseded by / supersedes'),
    ('REL-011', 'same as'),
    ('REL-012', 'supersedes / is superseded by')
        ) expected(id,relation_type_norm)
        LEFT JOIN vocab_workbench.relation_type_concept_ids actual USING (id)
        WHERE expected.relation_type_norm IS DISTINCT FROM actual.relation_type_norm
    ) THEN RAISE EXCEPTION 'Published relationship IDs differ from the saved mapping'; END IF;
    IF EXISTS (
        SELECT 1 FROM vocab_workbench.relation_type_concept_ids m
        CROSS JOIN (VALUES ('forward'),('reverse')) d(direction)
        LEFT JOIN ui.relation_type_labels l
          ON l.relation_type_norm=m.relation_type_norm AND l.relation_direction=d.direction
        GROUP BY m.id,d.direction
        HAVING count(l.relation_type_norm)<>1 OR count(NULLIF(btrim(l.label_en),''))<>1
    ) THEN RAISE EXCEPTION 'A published relationship does not have exactly one English label in each direction'; END IF;
END
$verify$;

CREATE OR REPLACE VIEW ui.v_wb_resource_relationships AS
SELECT m.id, m.relation_type_norm AS canonical_value,
       CASE WHEN btrim(f.label_en)=btrim(r.label_en) THEN btrim(f.label_en) ELSE btrim(f.label_en) || ' / ' || btrim(r.label_en) END AS display_en,
       btrim(f.label_en) AS forward_en, btrim(r.label_en) AS reverse_en,
       CASE WHEN btrim(f.label_ru)=btrim(r.label_ru) THEN btrim(f.label_ru) ELSE btrim(f.label_ru) || ' / ' || btrim(r.label_ru) END AS display_ru,
       btrim(f.label_ru) AS forward_ru, btrim(r.label_ru) AS reverse_ru,
       CASE WHEN btrim(f.label_zh)=btrim(r.label_zh) THEN btrim(f.label_zh) ELSE btrim(f.label_zh) || ' / ' || btrim(r.label_zh) END AS display_zh,
       btrim(f.label_zh) AS forward_zh, btrim(r.label_zh) AS reverse_zh,
       CASE WHEN btrim(f.label_kk)=btrim(r.label_kk) THEN btrim(f.label_kk) ELSE btrim(f.label_kk) || ' / ' || btrim(r.label_kk) END AS display_kk,
       btrim(f.label_kk) AS forward_kk, btrim(r.label_kk) AS reverse_kk,
       CASE WHEN btrim(f.label_ky)=btrim(r.label_ky) THEN btrim(f.label_ky) ELSE btrim(f.label_ky) || ' / ' || btrim(r.label_ky) END AS display_ky,
       btrim(f.label_ky) AS forward_ky, btrim(r.label_ky) AS reverse_ky,
       CASE WHEN btrim(f.label_tg)=btrim(r.label_tg) THEN btrim(f.label_tg) ELSE btrim(f.label_tg) || ' / ' || btrim(r.label_tg) END AS display_tg,
       btrim(f.label_tg) AS forward_tg, btrim(r.label_tg) AS reverse_tg,
       CASE WHEN btrim(f.label_tk)=btrim(r.label_tk) THEN btrim(f.label_tk) ELSE btrim(f.label_tk) || ' / ' || btrim(r.label_tk) END AS display_tk,
       btrim(f.label_tk) AS forward_tk, btrim(r.label_tk) AS reverse_tk,
       CASE WHEN btrim(f.label_uz)=btrim(r.label_uz) THEN btrim(f.label_uz) ELSE btrim(f.label_uz) || ' / ' || btrim(r.label_uz) END AS display_uz,
       btrim(f.label_uz) AS forward_uz, btrim(r.label_uz) AS reverse_uz
FROM vocab_workbench.relation_type_concept_ids m
JOIN ui.relation_type_labels f ON f.relation_type_norm=m.relation_type_norm AND f.relation_direction='forward'
JOIN ui.relation_type_labels r ON r.relation_type_norm=m.relation_type_norm AND r.relation_direction='reverse';

CREATE OR REPLACE VIEW ui.v_wb_vernacular_building_functions AS
SELECT id, sort_order, canonical_value, display_en, display_ru, display_zh, display_kk, display_ky, display_tg, display_tk, display_uz
FROM vocab_workbench.reference_labels WHERE vocabulary_code='vernacular-building-functions';

CREATE OR REPLACE VIEW ui.v_wb_vernacular_building_materials AS
SELECT id, sort_order, canonical_value, display_en, display_ru, display_zh, display_kk, display_ky, display_tg, display_tk, display_uz
FROM vocab_workbench.reference_labels WHERE vocabulary_code='vernacular-building-materials';

CREATE OR REPLACE VIEW ui.v_wb_vernacular_intervention_degrees AS
SELECT id, sort_order, canonical_value, display_en, display_ru, display_zh, display_kk, display_ky, display_tg, display_tk, display_uz
FROM vocab_workbench.reference_labels WHERE vocabulary_code='vernacular-intervention-degrees';

CREATE OR REPLACE VIEW ui.v_wb_vernacular_intervention_types AS
SELECT id, sort_order, canonical_value, display_en, display_ru, display_zh, display_kk, display_ky, display_tg, display_tk, display_uz
FROM vocab_workbench.reference_labels WHERE vocabulary_code='vernacular-intervention-types';

CREATE OR REPLACE VIEW ui.v_wb_vernacular_occupation_status AS
SELECT id, sort_order, canonical_value, display_en, display_ru, display_zh, display_kk, display_ky, display_tg, display_tk, display_uz
FROM vocab_workbench.reference_labels WHERE vocabulary_code='vernacular-occupation-status';

CREATE OR REPLACE VIEW ui.v_wb_vernacular_open_spaces AS
SELECT id, sort_order, canonical_value, display_en, display_ru, display_zh, display_kk, display_ky, display_tg, display_tk, display_uz
FROM vocab_workbench.reference_labels WHERE vocabulary_code='vernacular-open-spaces';

CREATE OR REPLACE VIEW ui.v_wb_vernacular_roof_materials AS
SELECT id, sort_order, canonical_value, display_en, display_ru, display_zh, display_kk, display_ky, display_tg, display_tk, display_uz
FROM vocab_workbench.reference_labels WHERE vocabulary_code='vernacular-roof-materials';

INSERT INTO vocab_workbench.editor_registry(vocabulary_code,title,source_view,concept_uri_base) VALUES
    ('resource-relationships', 'Resource Relationships', 'ui.v_wb_resource_relationships', 'https://vocab.uclcaal.org/concept/resource-relationships/'),
    ('vernacular-building-functions', 'Vernacular building functions', 'ui.v_wb_vernacular_building_functions', 'https://vocab.uclcaal.org/concept/vernacular-building-functions/'),
    ('vernacular-building-materials', 'Vernacular building materials', 'ui.v_wb_vernacular_building_materials', 'https://vocab.uclcaal.org/concept/vernacular-building-materials/'),
    ('vernacular-intervention-degrees', 'Vernacular degrees of intervention', 'ui.v_wb_vernacular_intervention_degrees', 'https://vocab.uclcaal.org/concept/vernacular-intervention-degrees/'),
    ('vernacular-intervention-types', 'Vernacular building intervention types', 'ui.v_wb_vernacular_intervention_types', 'https://vocab.uclcaal.org/concept/vernacular-intervention-types/'),
    ('vernacular-occupation-status', 'Vernacular building occupation status', 'ui.v_wb_vernacular_occupation_status', 'https://vocab.uclcaal.org/concept/vernacular-occupation-status/'),
    ('vernacular-open-spaces', 'Vernacular open spaces', 'ui.v_wb_vernacular_open_spaces', 'https://vocab.uclcaal.org/concept/vernacular-open-spaces/'),
    ('vernacular-roof-materials', 'Vernacular building roof materials', 'ui.v_wb_vernacular_roof_materials', 'https://vocab.uclcaal.org/concept/vernacular-roof-materials/')
ON CONFLICT (vocabulary_code) DO NOTHING;

INSERT INTO public.vocabulary_schemes(vocabulary_code,scheme_uri,concept_uri_base,source)
SELECT vocabulary_code, 'https://vocab.uclcaal.org/scheme/' || vocabulary_code, concept_uri_base, 'workbench_registry'
FROM vocab_workbench.editor_registry
WHERE vocabulary_code IN ('resource-relationships', 'vernacular-building-functions', 'vernacular-building-materials', 'vernacular-intervention-degrees', 'vernacular-intervention-types', 'vernacular-occupation-status', 'vernacular-open-spaces', 'vernacular-roof-materials')
ON CONFLICT (vocabulary_code) DO NOTHING;

INSERT INTO public.vocabulary_scheme_labels(vocabulary_code,lang,label,source)
SELECT v.slug,v.lang,v.label,'workbench' FROM (VALUES
    ('resource-relationships', 'en', 'Resource Relationships'),
    ('resource-relationships', 'ru', 'Типы взаимосвязей между ресурсами'),
    ('resource-relationships', 'tk', 'Resursdan Resursa Gatnaşyk Görnüşleri'),
    ('resource-relationships', 'uz', 'Resursdan resursga bog‘liqlik turlari'),
    ('resource-relationships', 'zh', '资源间关系类型'),
    ('vernacular-building-functions', 'en', 'Vernacular building functions'),
    ('vernacular-building-functions', 'kk', 'Дәстүрлі (вернакулярлық) құрылыстардың функциялары'),
    ('vernacular-building-functions', 'ru', 'Функции традиционной (вернакулярной) застройки'),
    ('vernacular-building-functions', 'tk', 'Ýerli binalaryň funksiýalary'),
    ('vernacular-building-functions', 'uz', 'Mahalliy binolarning vazifalari'),
    ('vernacular-building-functions', 'zh', '乡土建筑功能'),
    ('vernacular-building-materials', 'en', 'Vernacular building materials'),
    ('vernacular-building-materials', 'kk', 'Дәстүрлі құрылыс материалдары'),
    ('vernacular-building-materials', 'ru', 'Традиционные строительные материалы'),
    ('vernacular-building-materials', 'tk', 'Yerli binalaryň gurluşyk materiallary'),
    ('vernacular-building-materials', 'uz', 'Mahalliy bino qurilish ashyosi'),
    ('vernacular-building-materials', 'zh', '乡土建筑材料'),
    ('vernacular-intervention-degrees', 'en', 'Vernacular degrees of intervention'),
    ('vernacular-intervention-degrees', 'kk', 'Дәстүрлі (вернакулярлық) ортаға араласу дәрежелері'),
    ('vernacular-intervention-degrees', 'ru', 'Степени местного вмешательства'),
    ('vernacular-intervention-degrees', 'tk', 'Ýerli intervensiya derejeleri'),
    ('vernacular-intervention-degrees', 'uz', 'Aralashuvning mahalliy darajalari'),
    ('vernacular-intervention-degrees', 'zh', '乡土建筑干预程度'),
    ('vernacular-intervention-types', 'en', 'Vernacular building intervention types'),
    ('vernacular-intervention-types', 'kk', 'Дәстүрлі (вернакулярлық) құрылыстарға араласу түрлері'),
    ('vernacular-intervention-types', 'ru', 'Типы вмешательства в традиционную (вернакулярную) застройку'),
    ('vernacular-intervention-types', 'tk', 'Ýerli intervensiya derejeleri'),
    ('vernacular-intervention-types', 'uz', 'Mahalliy binolarga aralashuv turlari'),
    ('vernacular-intervention-types', 'zh', '乡土建筑干预方式'),
    ('vernacular-occupation-status', 'en', 'Vernacular building occupation status'),
    ('vernacular-occupation-status', 'kk', 'Дәстүрлі құрылыстардың қоныстану мәртебесі'),
    ('vernacular-occupation-status', 'ru', 'Статус заселённости традиционных построек'),
    ('vernacular-occupation-status', 'tk', 'Ýerli binalaryň ulanyş statusy'),
    ('vernacular-occupation-status', 'uz', 'Mahalliy binoning foydalanish holati'),
    ('vernacular-occupation-status', 'zh', '乡土建筑占用状态'),
    ('vernacular-open-spaces', 'en', 'Vernacular open spaces'),
    ('vernacular-open-spaces', 'kk', 'Дәстүрлі құрылыс ашық кеңістік түрлері'),
    ('vernacular-open-spaces', 'ru', 'Типы открытых пространств в местной застройке'),
    ('vernacular-open-spaces', 'tk', 'Ýerli binalardaky açyk giňişlikleriniň görnüşleri'),
    ('vernacular-open-spaces', 'uz', 'Mahalliy binoga tutash ochiq joy turlari'),
    ('vernacular-open-spaces', 'zh', '乡土建筑开放空间类型'),
    ('vernacular-roof-materials', 'en', 'Vernacular building roof materials'),
    ('vernacular-roof-materials', 'kk', 'Дәстүрлі шатыр материалдары'),
    ('vernacular-roof-materials', 'ru', 'Традиционные кровельные материалы'),
    ('vernacular-roof-materials', 'tk', 'Ýerli bina üçekleriniň materiallary'),
    ('vernacular-roof-materials', 'uz', 'Mahalliy bino tom qurilish ashyosi'),
    ('vernacular-roof-materials', 'zh', '乡土建筑屋顶材料')
) v(slug,lang,label)
ON CONFLICT (vocabulary_code,lang) DO NOTHING;

DO $roles$
DECLARE r text;
BEGIN
    FOR r IN SELECT DISTINCT grantee FROM information_schema.table_privileges
        WHERE table_schema='vocab_workbench' AND table_name='editor_texts'
          AND privilege_type='INSERT' AND grantee<>'PUBLIC'
    LOOP
        EXECUTE format('GRANT SELECT ON ui.v_wb_resource_relationships, ui.v_wb_vernacular_building_functions, ui.v_wb_vernacular_building_materials, ui.v_wb_vernacular_intervention_degrees, ui.v_wb_vernacular_intervention_types, ui.v_wb_vernacular_occupation_status, ui.v_wb_vernacular_open_spaces, ui.v_wb_vernacular_roof_materials TO %I',r);
        EXECUTE format('GRANT SELECT, UPDATE (display_en, display_ru, display_zh, display_kk, display_ky, display_tg, display_tk, display_uz) ON vocab_workbench.reference_labels TO %I',r);
        EXECUTE format('GRANT SELECT ON vocab_workbench.relation_type_concept_ids TO %I',r);
        EXECUTE format('GRANT SELECT, UPDATE (label_en, label_ru, label_zh, label_kk, label_ky, label_tg, label_tk, label_uz) ON ui.relation_type_labels TO %I',r);
    END LOOP;
END
$roles$;

INSERT INTO vocab_workbench.editor_migrations(version) VALUES ('008_reference_vocabularies')
ON CONFLICT DO NOTHING;
COMMIT;
