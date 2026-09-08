/* ============================ SUPABASE SETUP ============================ */
import { SUPABASE_URL, SUPABASE_ANON_KEY, GOOGLE_CLIENT_ID, GOOGLE_DRIVE_FOLDER_ID } from './config.js';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// GOOGLE_DRIVE_FOLDER_ID di config.js boleh diisi URL folder lengkap atau ID saja.
function extractDriveFolderId(v){
  if(!v) return '';
  const m = String(v).match(/[-\w]{20,}/);
  return m ? m[0] : String(v).trim();
}
const DRIVE_FOLDER_ID = extractDriveFolderId(GOOGLE_DRIVE_FOLDER_ID);

/* ============================ DATA LAYER (Supabase) ============================ */
function defaultSettings(){
  return {
    pemerintah: "PEMERINTAH KABUPATEN BREBES",
    dinas: "DINAS PENDIDIKAN PEMUDA DAN OLAHRAGA",
    korwilcam: "KORWILCAM SATPENDIK KECAMATAN TANJUNG",
    namaSekolah: "SD NEGERI TANJUNG 03",
    alamat: "Alamat : Jl. Cendrawasih No. 54, Tanjung, Kec.Tanjung, Kab. Brebes, Prov.Jawa Tengah 52254",
    tempat: "Tanjung",
    mapel: "Guru Penjasorkes",
    namaGuru: "Wahyu Riski Maulana, S.Pd.,Gr.",
    nip: "199608032022211003"
  };
}

// Cache lokal di memori (bukan localStorage) — sumber data sesungguhnya ada di Supabase.
let DATA = {
  classes: [],    // {id, nama}
  students: [],   // {id, classId, nama}
  attendance: {}, // cache per sesi: {[classId]: {[tanggal]: {[siswaId]: status}}}
  settings: defaultSettings()
};

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(()=>t.classList.remove('show'), 2200);
}

function dbErr(aksi, err){
  console.error(aksi, err);
  toast(`Gagal ${aksi}: ${(err && err.message) || err}`);
}

/* --------- KELAS --------- */
async function dbFetchKelas(){
  const { data, error } = await sb.from('kelas').select('*').order('nama', { ascending:true });
  if(error){ dbErr('memuat data kelas', error); return; }
  DATA.classes = (data||[]).map(k=>({ id:k.id, nama:k.nama }));
}
async function dbInsertKelas(nama){
  const kelas = { id: uid(), nama };
  const { error } = await sb.from('kelas').insert(kelas);
  if(error){ dbErr('menambah kelas', error); return null; }
  DATA.classes.push(kelas);
  return kelas;
}
async function dbDeleteKelas(id){
  const { error } = await sb.from('kelas').delete().eq('id', id);
  if(error){ dbErr('menghapus kelas', error); return false; }
  DATA.classes = DATA.classes.filter(c=>c.id!==id);
  DATA.students = DATA.students.filter(s=>s.classId!==id);
  delete DATA.attendance[id];
  return true;
}
async function dbUpdateKelasNama(id, nama){
  const { error } = await sb.from('kelas').update({ nama }).eq('id', id);
  if(error){ dbErr('mengubah nama kelas', error); return false; }
  const k = DATA.classes.find(x=>x.id===id);
  if(k) k.nama = nama;
  return true;
}

/* --------- SISWA --------- */
async function dbFetchSiswa(){
  const { data, error } = await sb.from('siswa').select('*');
  if(error){ dbErr('memuat data siswa', error); return; }
  DATA.students = (data||[]).map(s=>({ id:s.id, classId:s.kelas_id, nama:s.nama }));
}
async function dbInsertSiswaBanyak(classId, namaList){
  const rows = namaList.map(nama=>({ id: uid(), kelas_id: classId, nama }));
  const { error } = await sb.from('siswa').insert(rows);
  if(error){ dbErr('menambah siswa', error); return false; }
  rows.forEach(r=> DATA.students.push({ id:r.id, classId:r.kelas_id, nama:r.nama }));
  return true;
}
async function dbDeleteSiswa(id){
  const { error } = await sb.from('siswa').delete().eq('id', id);
  if(error){ dbErr('menghapus siswa', error); return false; }
  DATA.students = DATA.students.filter(x=>x.id!==id);
  // Bersihkan juga dari cache presensi di memori supaya id siswa yang sudah
  // dihapus tidak ikut terkirim lagi saat "Simpan Presensi" pada tanggal
  // yang sudah pernah dibuka sebelumnya (penyebab error foreign key 23503).
  Object.values(DATA.attendance).forEach(byDate=>{
    Object.values(byDate).forEach(rec=>{ delete rec[id]; });
  });
  return true;
}
async function dbUpdateSiswaNama(id, nama){
  const { error } = await sb.from('siswa').update({ nama }).eq('id', id);
  if(error){ dbErr('mengubah nama siswa', error); return false; }
  const s = DATA.students.find(x=>x.id===id);
  if(s) s.nama = nama;
  return true;
}

/* --------- PRESENSI (ATTENDANCE) --------- */
async function dbFetchAttendanceForDate(classId, date){
  const { data, error } = await sb.from('presensi').select('siswa_id,status')
    .eq('kelas_id', classId).eq('tanggal', date);
  if(error){ dbErr('memuat presensi', error); return {}; }
  const rec = {};
  (data||[]).forEach(r=> rec[r.siswa_id] = r.status);
  if(!DATA.attendance[classId]) DATA.attendance[classId] = {};
  DATA.attendance[classId][date] = rec;
  return rec;
}
async function dbSaveAttendance(classId, date, record){
  // Filter ganda: hanya kirim siswa yang benar-benar masih ada di data siswa saat ini.
  // Ini jaring pengaman terakhir kalau `record` di memori masih membawa id siswa yang
  // sudah dihapus (mis. dihapus dari perangkat/tab lain) -> mencegah error foreign key.
  const validIds = new Set(DATA.students.filter(s=>s.classId===classId).map(s=>s.id));
  const rows = Object.keys(record)
    .filter(siswaId=>validIds.has(siswaId))
    .map(siswaId=>({
      kelas_id: classId, siswa_id: siswaId, tanggal: date, status: record[siswaId]
    }));
  if(!rows.length) return true;
  const { error } = await sb.from('presensi').upsert(rows, { onConflict: 'kelas_id,siswa_id,tanggal' });
  if(error){
    if(error.code === '23503'){
      toast('Gagal menyimpan: ada siswa di daftar ini yang sudah terhapus/tidak sinkron. Silakan muat ulang (refresh) halaman lalu coba lagi.');
      console.error('menyimpan presensi', error);
    } else {
      dbErr('menyimpan presensi', error);
    }
    return false;
  }
  return true;
}
async function dbUpdateAttendanceStatus(classId, siswaId, date, status){
  const { error } = await sb.from('presensi')
    .upsert({ kelas_id: classId, siswa_id: siswaId, tanggal: date, status }, { onConflict: 'kelas_id,siswa_id,tanggal' });
  if(error){ dbErr('mengubah presensi', error); return false; }
  if(DATA.attendance[classId] && DATA.attendance[classId][date]) DATA.attendance[classId][date][siswaId] = status;
  return true;
}
async function dbDeleteAttendanceRecord(classId, siswaId, date){
  const { error } = await sb.from('presensi').delete()
    .eq('kelas_id', classId).eq('siswa_id', siswaId).eq('tanggal', date);
  if(error){ dbErr('menghapus data presensi', error); return false; }
  if(DATA.attendance[classId] && DATA.attendance[classId][date]) delete DATA.attendance[classId][date][siswaId];
  return true;
}
async function dbDeleteAttendanceForDate(classId, date){
  const { error } = await sb.from('presensi').delete()
    .eq('kelas_id', classId).eq('tanggal', date);
  if(error){ dbErr('menghapus presensi tanggal ini', error); return false; }
  if(DATA.attendance[classId]) delete DATA.attendance[classId][date];
  return true;
}
async function dbFetchAttendanceRange(classId, start, end){
  const { data, error } = await sb.from('presensi').select('siswa_id,tanggal,status')
    .eq('kelas_id', classId).gte('tanggal', start).lte('tanggal', end);
  if(error){ dbErr('memuat rekap presensi', error); return {}; }
  const byDate = {};
  (data||[]).forEach(r=>{
    if(!byDate[r.tanggal]) byDate[r.tanggal] = {};
    byDate[r.tanggal][r.siswa_id] = r.status;
  });
  return byDate;
}

/* --------- JURNAL HARIAN --------- */
// Catatan resmi harian / agenda kegiatan kelas: tanggal, jam, kelas, mapel, materi,
// ketercapaian tujuan pembelajaran. Presensi siswa diambil otomatis dari tabel
// 'presensi' yang sudah ada (per kelas_id + tanggal), tidak disimpan dobel di sini.
async function dbFetchJurnal(classId, start, end){
  let q = sb.from('jurnal').select('*').order('tanggal', { ascending:false }).order('jam', { ascending:true });
  if(classId) q = q.eq('kelas_id', classId);
  if(start) q = q.gte('tanggal', start);
  if(end) q = q.lte('tanggal', end);
  const { data, error } = await q;
  if(error){ dbErr('memuat jurnal harian', error); return []; }
  return (data||[]).map(j=>({
    id:j.id, classId:j.kelas_id, tanggal:j.tanggal, jam:j.jam, mapel:j.mapel,
    materi:j.materi, ketercapaian:j.ketercapaian, catatan:j.catatan
  }));
}
async function dbInsertJurnal(entry){
  const row = {
    id: uid(), kelas_id: entry.classId, tanggal: entry.tanggal, jam: entry.jam,
    mapel: entry.mapel, materi: entry.materi, ketercapaian: entry.ketercapaian, catatan: entry.catatan || ''
  };
  const { error } = await sb.from('jurnal').insert(row);
  if(error){ dbErr('menyimpan jurnal', error); return null; }
  return row;
}
async function dbUpdateJurnal(id, entry){
  const { error } = await sb.from('jurnal').update({
    kelas_id: entry.classId, tanggal: entry.tanggal, jam: entry.jam,
    mapel: entry.mapel, materi: entry.materi, ketercapaian: entry.ketercapaian, catatan: entry.catatan || ''
  }).eq('id', id);
  if(error){ dbErr('mengubah jurnal', error); return false; }
  return true;
}
async function dbDeleteJurnal(id){
  const { error } = await sb.from('jurnal').delete().eq('id', id);
  if(error){ dbErr('menghapus jurnal', error); return false; }
  return true;
}

/* --------- PENGATURAN (SETTINGS) --------- */
async function dbFetchSettings(){
  const { data, error } = await sb.from('pengaturan').select('*').eq('id','main').maybeSingle();
  if(error){ dbErr('memuat pengaturan', error); return; }
  if(data){
    DATA.settings = {
      pemerintah: data.pemerintah || defaultSettings().pemerintah,
      dinas: data.dinas || defaultSettings().dinas,
      korwilcam: data.korwilcam || defaultSettings().korwilcam,
      namaSekolah: data.nama_sekolah || defaultSettings().namaSekolah,
      alamat: data.alamat || defaultSettings().alamat,
      tempat: data.tempat || defaultSettings().tempat,
      mapel: data.mapel || defaultSettings().mapel,
      namaGuru: data.nama_guru || defaultSettings().namaGuru,
      nip: data.nip || defaultSettings().nip
    };
  } else {
    await dbSaveSettings(defaultSettings());
  }
}
async function dbSaveSettings(settings){
  const row = {
    id: 'main',
    pemerintah: settings.pemerintah,
    dinas: settings.dinas,
    korwilcam: settings.korwilcam,
    nama_sekolah: settings.namaSekolah,
    alamat: settings.alamat,
    tempat: settings.tempat,
    mapel: settings.mapel,
    nama_guru: settings.namaGuru,
    nip: settings.nip
  };
  const { error } = await sb.from('pengaturan').upsert(row, { onConflict: 'id' });
  if(error){ dbErr('menyimpan pengaturan', error); return false; }
  DATA.settings = settings;
  return true;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============================ NAV ============================ */
document.querySelectorAll('nav.tabs .tab').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    document.querySelectorAll('nav.tabs .tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('main .page').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.page).classList.add('active');
    if(btn.dataset.page === 'presensi') await renderPresensi();
    if(btn.dataset.page === 'rekap') await renderRekap();
    if(btn.dataset.page === 'jurnal') await renderJurnalList();
  });
});

/* ============================ KELAS ============================ */
let kelasAktifId = null;

function renderKelasChips(){
  const wrap = document.getElementById('daftarKelasChip');
  const empty = document.getElementById('kelasEmptyMsg');
  wrap.innerHTML = '';
  empty.hidden = DATA.classes.length !== 0;
  if(kelasAktifId && !DATA.classes.find(k=>k.id===kelasAktifId)) kelasAktifId = null;
  if(!kelasAktifId && DATA.classes.length) kelasAktifId = DATA.classes[0].id;

  DATA.classes.forEach(k=>{
    const chip = document.createElement('div');
    chip.className = 'chip' + (k.id===kelasAktifId ? ' active' : '');
    chip.innerHTML = `<span>${escapeHtml(k.nama)}</span><span class="edit" data-edit="${k.id}" title="Ubah nama kelas">✎</span><span class="del" data-del="${k.id}" title="Hapus kelas">✕</span>`;
    chip.addEventListener('click', (e)=>{
      if(e.target.dataset.del || e.target.dataset.edit) return;
      kelasAktifId = k.id;
      renderKelasChips();
      renderSiswaList();
    });
    chip.querySelector('.edit').addEventListener('click', async (e)=>{
      e.stopPropagation();
      const baru = prompt('Ubah nama kelas:', k.nama);
      if(baru === null) return; // dibatalkan
      const trimmed = baru.trim();
      if(!trimmed || trimmed === k.nama) return;
      const ok = await dbUpdateKelasNama(k.id, trimmed);
      if(!ok) return;
      renderKelasChips();
      refreshKelasSelects();
      toast('Nama kelas diperbarui');
    });
    chip.querySelector('.del').addEventListener('click', async (e)=>{
      e.stopPropagation();
      if(confirm(`Hapus kelas "${k.nama}"? Semua data siswa & presensi di kelas ini juga akan terhapus.`)){
        const ok = await dbDeleteKelas(k.id);
        if(!ok) return;
        renderKelasChips();
        renderSiswaList();
        refreshKelasSelects();
        toast('Kelas dihapus');
      }
    });
    wrap.appendChild(chip);
  });

  document.getElementById('kelasAktifLabel').textContent = kelasAktifId
    ? '- ' + DATA.classes.find(k=>k.id===kelasAktifId).nama : '';
}

document.getElementById('formKelas').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const inp = document.getElementById('inputKelasNama');
  const nama = inp.value.trim();
  if(!nama) return;
  const kelas = await dbInsertKelas(nama);
  if(!kelas) return;
  kelasAktifId = kelas.id;
  inp.value = '';
  renderKelasChips();
  renderSiswaList();
  refreshKelasSelects();
  toast('Kelas ditambahkan');
});

/* ============================ SISWA ============================ */
function renderSiswaList(){
  const tbody = document.getElementById('daftarSiswaBody');
  const emptyMsg = document.getElementById('siswaEmptyMsg');
  tbody.innerHTML = '';
  if(!kelasAktifId){ emptyMsg.hidden = false; emptyMsg.textContent = 'Pilih atau buat kelas terlebih dahulu.'; return; }
  const list = DATA.students.filter(s=>s.classId===kelasAktifId)
    .sort((a,b)=>a.nama.localeCompare(b.nama,'id'));
  emptyMsg.hidden = list.length>0;
  emptyMsg.textContent = 'Belum ada siswa di kelas ini.';
  list.forEach((s,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td class="siswa-nama-cell">${escapeHtml(s.nama)}</td>
      <td style="white-space:nowrap"><button class="btn secondary sm" data-edit="${s.id}">Edit</button> <button class="btn danger sm" data-del="${s.id}">Hapus</button></td>`;
    tr.querySelector('[data-del]').addEventListener('click', async ()=>{
      if(confirm(`Hapus siswa "${s.nama}"?`)){
        const ok = await dbDeleteSiswa(s.id);
        if(!ok) return;
        renderSiswaList();
        toast('Siswa dihapus');
      }
    });
    tr.querySelector('[data-edit]').addEventListener('click', ()=>{
      const namaCell = tr.querySelector('.siswa-nama-cell');
      const oldNama = s.nama;
      namaCell.innerHTML = '';
      const inputEdit = document.createElement('input');
      inputEdit.type = 'text';
      inputEdit.value = oldNama;
      inputEdit.style.width = '100%';
      const btnRow = document.createElement('div');
      btnRow.className = 'row';
      btnRow.style.cssText = 'margin-top:6px;gap:6px';
      const btnSave = document.createElement('button');
      btnSave.type = 'button'; btnSave.className = 'btn primary sm'; btnSave.textContent = 'Simpan';
      const btnCancel = document.createElement('button');
      btnCancel.type = 'button'; btnCancel.className = 'btn secondary sm'; btnCancel.textContent = 'Batal';
      btnRow.appendChild(btnSave); btnRow.appendChild(btnCancel);
      namaCell.appendChild(inputEdit); namaCell.appendChild(btnRow);
      inputEdit.focus(); inputEdit.select();
      btnCancel.addEventListener('click', renderSiswaList);
      inputEdit.addEventListener('keydown', (e)=>{
        if(e.key === 'Escape') renderSiswaList();
        if(e.key === 'Enter'){ e.preventDefault(); btnSave.click(); }
      });
      btnSave.addEventListener('click', async ()=>{
        const baru = inputEdit.value.trim();
        if(!baru){ toast('Nama tidak boleh kosong'); return; }
        if(baru === oldNama){ renderSiswaList(); return; }
        const ok = await dbUpdateSiswaNama(s.id, baru);
        if(!ok) return;
        renderSiswaList();
        toast('Nama siswa diperbarui');
      });
    });
    tbody.appendChild(tr);
  });
}

document.getElementById('formSiswa').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!kelasAktifId){ toast('Pilih kelas terlebih dahulu'); return; }
  const inp = document.getElementById('inputSiswaNama');
  const nama = inp.value.trim();
  if(!nama) return;
  const ok = await dbInsertSiswaBanyak(kelasAktifId, [nama]);
  if(!ok) return;
  inp.value='';
  renderSiswaList();
});

document.getElementById('importSiswaBtn').addEventListener('click', async ()=>{
  if(!kelasAktifId){ toast('Pilih kelas terlebih dahulu'); return; }
  const ta = document.getElementById('importSiswaText');
  const lines = ta.value.split('\n').map(x=>x.trim()).filter(Boolean);
  if(!lines.length) return;
  const ok = await dbInsertSiswaBanyak(kelasAktifId, lines);
  if(!ok) return;
  ta.value = '';
  renderSiswaList();
  toast(`${lines.length} siswa ditambahkan`);
});

/* ============================ SELECT REFRESH ============================ */
function refreshKelasSelects(){
  ['presensiKelas','rekapKelas','jurnalKelas','jurnalFilterKelas'].forEach(id=>{
    const sel = document.getElementById(id);
    if(!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    if(DATA.classes.length===0){
      sel.innerHTML = '<option value="">(Belum ada kelas)</option>';
      return;
    }
    DATA.classes.forEach(k=>{
      const opt = document.createElement('option');
      opt.value = k.id; opt.textContent = k.nama;
      sel.appendChild(opt);
    });
    if(DATA.classes.find(k=>k.id===prev)) sel.value = prev;
  });
}

/* ============================ PRESENSI HARIAN ============================ */
function todayStr(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
document.getElementById('presensiTanggal').value = todayStr();

const STATUS_LABEL = {H:'Hadir', S:'Sakit', I:'Izin', A:'Tanpa Keterangan'};

async function getAttendanceRecord(classId, date){
  if(DATA.attendance[classId] && DATA.attendance[classId][date]) return DATA.attendance[classId][date];
  return await dbFetchAttendanceForDate(classId, date);
}

async function renderPresensi(){
  refreshKelasSelects();
  const classId = document.getElementById('presensiKelas').value;
  const date = document.getElementById('presensiTanggal').value || todayStr();
  const tbody = document.getElementById('presensiBody');
  const emptyMsg = document.getElementById('presensiEmptyMsg');
  tbody.innerHTML = '';
  if(!classId){ emptyMsg.hidden = false; emptyMsg.textContent = 'Buat kelas terlebih dahulu di menu "Kelas & Siswa".'; updatePresensiStats({}); return; }

  const list = DATA.students.filter(s=>s.classId===classId).sort((a,b)=>a.nama.localeCompare(b.nama,'id'));
  emptyMsg.hidden = list.length>0;
  if(!list.length){ updatePresensiStats({}); return; }

  const record = await getAttendanceRecord(classId, date);

  // Buang entri siswa yang sudah tidak ada lagi (mis. dihapus di menu "Kelas & Siswa"
  // tapi datanya sempat ke-cache di memori sebelum dihapus) supaya tidak ikut terkirim
  // saat "Simpan Presensi" -> mencegah error foreign key ("Key is not present in table siswa").
  const validIds = new Set(list.map(s=>s.id));
  Object.keys(record).forEach(id=>{ if(!validIds.has(id)) delete record[id]; });

  list.forEach((s,i)=>{
    if(!record[s.id]) record[s.id] = 'H';
    const tr = document.createElement('tr');
    tr.className = 'student-row';
    tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(s.nama)}</td><td></td>`;
    const statusCell = tr.children[2];
    const btnWrap = document.createElement('div');
    btnWrap.className = 'status-btns';
    ['H','S','I','A'].forEach(st=>{
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stbtn ' + st + (record[s.id]===st ? ' sel' : '');
      b.textContent = st;
      b.title = STATUS_LABEL[st];
      b.addEventListener('click', ()=>{
        record[s.id] = st;
        btnWrap.querySelectorAll('.stbtn').forEach(x=>x.classList.remove('sel'));
        b.classList.add('sel');
        updatePresensiStats(record);
      });
      btnWrap.appendChild(b);
    });
    statusCell.appendChild(btnWrap);
    tbody.appendChild(tr);
  });
  updatePresensiStats(record);
}

function updatePresensiStats(record){
  const counts = {H:0,S:0,I:0,A:0};
  Object.values(record).forEach(st=>{ if(counts[st]!==undefined) counts[st]++; });
  const box = document.getElementById('presensiStats');
  box.innerHTML = `
    <div class="stat-box H"><b>${counts.H}</b><span>Hadir</span></div>
    <div class="stat-box S"><b>${counts.S}</b><span>Sakit</span></div>
    <div class="stat-box I"><b>${counts.I}</b><span>Izin</span></div>
    <div class="stat-box A"><b>${counts.A}</b><span>Tanpa Keterangan</span></div>
  `;
}

document.getElementById('presensiKelas').addEventListener('change', renderPresensi);
document.getElementById('presensiTanggal').addEventListener('change', renderPresensi);

document.getElementById('btnSemuaHadir').addEventListener('click', async ()=>{
  const classId = document.getElementById('presensiKelas').value;
  const date = document.getElementById('presensiTanggal').value || todayStr();
  if(!classId) return;
  const list = DATA.students.filter(s=>s.classId===classId);
  const record = await getAttendanceRecord(classId, date);
  list.forEach(s=> record[s.id] = 'H');
  renderPresensi();
  toast('Semua siswa ditandai Hadir');
});

document.getElementById('btnSimpanPresensi').addEventListener('click', async ()=>{
  const classId = document.getElementById('presensiKelas').value;
  if(!classId){ toast('Pilih kelas terlebih dahulu'); return; }
  const date = document.getElementById('presensiTanggal').value || todayStr();
  const record = await getAttendanceRecord(classId, date);
  const ok = await dbSaveAttendance(classId, date, record);
  if(!ok) return;
  toast(`Presensi tanggal ${formatIndoDateFromStr(date)} tersimpan`);
});

/* ============================ JURNAL HARIAN ============================ */
document.getElementById('jurnalTanggal').value = todayStr();
document.getElementById('jurnalMapel').value = DATA.settings.mapel || '';

let jurnalEditId = null;

function statusPresensiSingkat(rec){
  if(!rec || Object.keys(rec).length===0) return '<span class="small-muted">Belum diisi</span>';
  const c = {H:0,S:0,I:0,A:0};
  Object.values(rec).forEach(st=>{ if(c[st]!==undefined) c[st]++; });
  return `H:${c.H} S:${c.S} I:${c.I} A:${c.A}`;
}

async function renderJurnalList(){
  const classId = document.getElementById('jurnalFilterKelas').value || null;
  const bulan = document.getElementById('jurnalFilterBulan').value; // "YYYY-MM"
  let start = null, end = null;
  if(bulan){
    start = bulan + '-01';
    const [y,m] = bulan.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    end = bulan + '-' + String(lastDay).padStart(2,'0');
  }
  const list = await dbFetchJurnal(classId, start, end);
  const tbody = document.getElementById('jurnalListBody');
  const emptyMsg = document.getElementById('jurnalEmptyMsg');
  if(list.length === 0){
    tbody.innerHTML = '';
    emptyMsg.hidden = false;
    window._lastJurnalList = [];
    return;
  }
  emptyMsg.hidden = true;

  // Ambil presensi untuk tiap entri (per kelas+tanggal) supaya ringkasan H/S/I/A bisa ditampilkan.
  const rows = [];
  for(const j of list){
    const kelas = DATA.classes.find(k=>k.id===j.classId);
    const rec = await dbFetchAttendanceForDate(j.classId, j.tanggal);
    rows.push({ ...j, kelasNama: kelas ? kelas.nama : '(kelas terhapus)', presensiRec: rec });
  }
  window._lastJurnalList = rows;

  tbody.innerHTML = rows.map(j=>`
    <tr>
      <td>${formatIndoDateFromStr(j.tanggal)}</td>
      <td>${escapeHtml(j.jam||'-')}</td>
      <td>${escapeHtml(j.kelasNama)}</td>
      <td style="max-width:260px;white-space:normal">${escapeHtml((j.materi||'').slice(0,120))}${(j.materi||'').length>120?'…':''}</td>
      <td>${statusPresensiSingkat(j.presensiRec)}</td>
      <td>
        <button class="btn secondary sm" type="button" data-edit="${j.id}">✏️</button>
        <button class="btn danger sm" type="button" data-del="${j.id}">🗑</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const j = rows.find(r=>r.id===b.dataset.edit);
      if(!j) return;
      jurnalEditId = j.id;
      document.getElementById('jurnalKelas').value = j.classId;
      document.getElementById('jurnalTanggal').value = j.tanggal;
      document.getElementById('jurnalJam').value = j.jam || '';
      document.getElementById('jurnalMapel').value = j.mapel || '';
      document.getElementById('jurnalMateri').value = j.materi || '';
      document.getElementById('jurnalKetercapaian').value = j.ketercapaian || '';
      document.getElementById('jurnalCatatan').value = j.catatan || '';
      document.getElementById('btnBatalEditJurnal').hidden = false;
      document.getElementById('btnSimpanJurnal').textContent = '💾 Simpan Perubahan';
      window.scrollTo({top:0, behavior:'smooth'});
    });
  });
  tbody.querySelectorAll('[data-del]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      if(!confirm('Hapus entri jurnal ini?')) return;
      const ok = await dbDeleteJurnal(b.dataset.del);
      if(!ok) return;
      toast('Jurnal dihapus');
      await renderJurnalList();
    });
  });
}

function resetJurnalForm(){
  jurnalEditId = null;
  document.getElementById('jurnalJam').value = '';
  document.getElementById('jurnalMateri').value = '';
  document.getElementById('jurnalKetercapaian').value = '';
  document.getElementById('jurnalCatatan').value = '';
  document.getElementById('jurnalMapel').value = DATA.settings.mapel || '';
  document.getElementById('btnBatalEditJurnal').hidden = true;
  document.getElementById('btnSimpanJurnal').textContent = '💾 Simpan Jurnal';
}

document.getElementById('btnBatalEditJurnal').addEventListener('click', resetJurnalForm);

document.getElementById('btnSimpanJurnal').addEventListener('click', async ()=>{
  const classId = document.getElementById('jurnalKelas').value;
  const tanggal = document.getElementById('jurnalTanggal').value;
  const materi = document.getElementById('jurnalMateri').value.trim();
  if(!classId){ toast('Pilih kelas terlebih dahulu'); return; }
  if(!tanggal){ toast('Pilih tanggal terlebih dahulu'); return; }
  if(!materi){ toast('Materi yang disampaikan wajib diisi'); return; }
  const entry = {
    classId, tanggal,
    jam: document.getElementById('jurnalJam').value.trim(),
    mapel: document.getElementById('jurnalMapel').value.trim() || (DATA.settings.mapel || ''),
    materi,
    ketercapaian: document.getElementById('jurnalKetercapaian').value.trim(),
    catatan: document.getElementById('jurnalCatatan').value.trim()
  };
  if(jurnalEditId){
    const ok = await dbUpdateJurnal(jurnalEditId, entry);
    if(!ok) return;
    toast('Jurnal diperbarui');
  } else {
    const row = await dbInsertJurnal(entry);
    if(!row) return;
    toast('Jurnal tersimpan');
  }
  resetJurnalForm();
  await renderJurnalList();
});

document.getElementById('jurnalFilterKelas').addEventListener('change', renderJurnalList);
document.getElementById('jurnalFilterBulan').addEventListener('change', renderJurnalList);

// ===== PDF Jurnal Harian (kop surat resmi sama seperti PDF rekap presensi) =====
async function buildJurnalPdfDoc(){
  const filterKelasId = document.getElementById('jurnalFilterKelas').value;
  if(!filterKelasId){ toast('Pilih kelas terlebih dahulu untuk mencetak jurnal'); return null; }
  await renderJurnalList();
  const rows = window._lastJurnalList || [];
  if(rows.length === 0){ toast('Tidak ada data jurnal untuk dicetak pada kelas/bulan ini'); return null; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'landscape', unit:'pt', format:'a4'});
  const pageWidth = doc.internal.pageSize.getWidth();
  const s = DATA.settings;

  await drawKopSurat(doc, pageWidth, s);
  const cx = pageWidth/2;
  const filterKelasNama = (DATA.classes.find(k=>k.id===filterKelasId)||{}).nama || '-';
  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text(`JURNAL HARIAN KELAS ${filterKelasNama.toUpperCase()}`, cx, 117, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  const bulan = document.getElementById('jurnalFilterBulan').value;
  const periodeTxt = `Kelas: ${filterKelasNama}${bulan ? '   |   Bulan: ' + bulan : ''}`;
  doc.text(periodeTxt, cx, 132, {align:'center'});

  const head = [['Tanggal','Jam','Mapel','Materi','Ketercapaian TP','Presensi (H/S/I/A)']];
  const body = rows.map(j=>{
    const c = {H:0,S:0,I:0,A:0};
    Object.values(j.presensiRec||{}).forEach(st=>{ if(c[st]!==undefined) c[st]++; });
    return [
      formatIndoDateFromStr(j.tanggal), j.jam||'-', j.mapel||'-',
      j.materi||'-', j.ketercapaian||'-', `${c.H}/${c.S}/${c.I}/${c.A}`
    ];
  });

  doc.autoTable({
    startY: 145,
    head, body,
    styles:{fontSize:8, halign:'left', valign:'top', cellPadding:4, lineColor:[210,215,225], lineWidth:0.5},
    headStyles:{fillColor:[13,44,102], textColor:255, fontStyle:'bold', halign:'center'},
    columnStyles:{
      0:{cellWidth:56, halign:'center'}, 1:{cellWidth:70, halign:'center'}, 2:{cellWidth:70},
      5:{cellWidth:90, halign:'center'}
    },
    margin:{left:40, right:40}
  });

  let finalY = doc.lastAutoTable.finalY + 40;
  const pageH = doc.internal.pageSize.getHeight();
  if(finalY > pageH - 90){ doc.addPage('a4','landscape'); finalY = 60; }

  const tglCetak = formatIndoDate(new Date());
  const signX = pageWidth - 220;
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  doc.text(`${s.tempat || 'Tanjung'}, ${tglCetak}`, signX, finalY, {align:'left'});
  doc.text(`${s.mapel || 'Guru Penjasorkes'}`, signX, finalY+15, {align:'left'});
  doc.setFont('helvetica','bold');
  doc.text(`${s.namaGuru || ''}`, signX, finalY+70, {align:'left'});
  doc.setFont('helvetica','normal');
  doc.text(`NIP. ${s.nip || ''}`, signX, finalY+85, {align:'left'});

  const fname = `Jurnal_Harian_${filterKelasNama.replace(/\s+/g,'_')}_${bulan||todayStr()}.pdf`;
  return { doc, fname };
}

document.getElementById('btnUnduhJurnalPdf').addEventListener('click', async ()=>{
  const built = await buildJurnalPdfDoc();
  if(!built) return;
  built.doc.save(built.fname);
});

/* ============================ KOP SURAT (PREVIEW) ============================ */
function renderKopPreview(){
  const s = DATA.settings;
  document.getElementById('kopPemerintahEl').textContent = s.pemerintah;
  document.getElementById('kopDinasEl').textContent = s.dinas;
  document.getElementById('kopKorwilcamEl').textContent = s.korwilcam;
  document.getElementById('kopSekolahEl').textContent = s.namaSekolah;
  document.getElementById('kopAlamatEl').textContent = s.alamat;
  document.getElementById('schoolNameTitle').textContent = s.namaSekolah;
}

/* ============================ SETTINGS ============================ */
function loadSettingsForm(){
  const s = DATA.settings;
  document.getElementById('setPemerintah').value = s.pemerintah || '';
  document.getElementById('setDinas').value = s.dinas || '';
  document.getElementById('setKorwilcam').value = s.korwilcam || '';
  document.getElementById('setNamaSekolah').value = s.namaSekolah || '';
  document.getElementById('setAlamat').value = s.alamat || '';
  document.getElementById('setTempat').value = s.tempat || '';
  document.getElementById('setMapel').value = s.mapel || '';
  document.getElementById('setNamaGuru').value = s.namaGuru || '';
  document.getElementById('setNip').value = s.nip || '';
}

document.getElementById('toggleSettingsRow').addEventListener('click', ()=>{
  const box = document.getElementById('settingsBox');
  box.hidden = !box.hidden;
  document.getElementById('settingsChevron').textContent = box.hidden ? 'Buka ▾' : 'Tutup ▴';
});

document.getElementById('btnSimpanSettings').addEventListener('click', async ()=>{
  const settings = Object.assign({}, DATA.settings, {
    pemerintah: document.getElementById('setPemerintah').value.trim() || defaultSettings().pemerintah,
    dinas: document.getElementById('setDinas').value.trim() || defaultSettings().dinas,
    korwilcam: document.getElementById('setKorwilcam').value.trim() || defaultSettings().korwilcam,
    namaSekolah: document.getElementById('setNamaSekolah').value.trim() || defaultSettings().namaSekolah,
    alamat: document.getElementById('setAlamat').value.trim() || defaultSettings().alamat,
    tempat: document.getElementById('setTempat').value.trim() || 'Tanjung',
    mapel: document.getElementById('setMapel').value.trim() || 'Guru Penjasorkes',
    namaGuru: document.getElementById('setNamaGuru').value.trim(),
    nip: document.getElementById('setNip').value.trim()
  });
  const ok = await dbSaveSettings(settings);
  if(!ok) return;
  renderKopPreview();
  document.getElementById('schoolSubTitle').textContent = 'Presensi Peserta Didik';
  toast('Pengaturan disimpan');
});

/* ============================ REKAP (PER TANGGAL) ============================ */
function currentMonthStr(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
document.getElementById('rekapBulan').value = currentMonthStr();
document.getElementById('semesterTahun').value = new Date().getFullYear();

// Toggle tampilan field: mode "Bulanan/Custom" biasa vs "Semester Guru Mapel"
// (guru mapel/PJOK biasanya cuma masuk 1x/minggu, jadi rekapnya dibuat per-6-bulan
// dan dikelompokkan per bulan, bukan per hari).
function updateRekapModeUI(){
  const semester = document.getElementById('rekapModeSemester').checked;
  document.getElementById('rekapBulanWrap').hidden = semester;
  document.getElementById('semesterJenisWrap').hidden = !semester;
  document.getElementById('semesterTahunWrap').hidden = !semester;
  document.getElementById('rekapCustomRangeWrap').hidden = semester;
  document.getElementById('rekapModeHint').textContent = semester
    ? 'Rekap akan mengambil semua data presensi pada rentang 6 bulan semester yang dipilih, dikelompokkan per bulan. Cocok untuk guru mapel yang hanya masuk 1x seminggu (±4 pertemuan/bulan).'
    : 'Kosongkan "Dari/Sampai Tanggal" untuk memakai rekap 1 bulan penuh sesuai pilihan "Bulan Rekap" di atas.';
}
document.getElementById('rekapModeSemester').addEventListener('change', ()=>{ updateRekapModeUI(); renderRekap(); });
document.getElementById('semesterJenis').addEventListener('change', renderRekap);
document.getElementById('semesterTahun').addEventListener('change', renderRekap);
updateRekapModeUI();

function computeSemesterRange(jenis, tahunMulaiStr){
  const y = parseInt(tahunMulaiStr, 10);
  if(!y) return null;
  if(jenis === 'genap'){
    const y2 = y + 1;
    return { start: `${y2}-01-01`, end: `${y2}-06-30` };
  }
  return { start: `${y}-07-01`, end: `${y}-12-31` };
}

function dateRangeFromInputs(){
  if(document.getElementById('rekapModeSemester').checked){
    const jenis = document.getElementById('semesterJenis').value;
    const tahun = document.getElementById('semesterTahun').value;
    return computeSemesterRange(jenis, tahun);
  }
  const bulan = document.getElementById('rekapBulan').value; // yyyy-mm
  const dari = document.getElementById('rekapDari').value;
  const sampai = document.getElementById('rekapSampai').value;
  if(dari && sampai) return {start: dari, end: sampai};
  if(bulan){
    const [y,m] = bulan.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2,'0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    return {start, end};
  }
  return null;
}

function shortDate(d){
  const [y,m,day] = d.split('-');
  return day+'/'+m;
}

// Nama bulan (dipakai juga oleh kop surat PDF, lihat bawah).
const BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function monthLabelFromYm(ym){
  const [y,m] = ym.split('-').map(Number);
  return BULAN_ID[m-1] + ' ' + y;
}
// Mengelompokkan daftar tanggal (sudah terurut) menjadi grup per-bulan berurutan.
function groupDatesByMonth(dates){
  const groups = [];
  dates.forEach(d=>{
    const ym = d.slice(0,7);
    let g = groups[groups.length-1];
    if(!g || g.ym !== ym){ g = {ym, label: monthLabelFromYm(ym), dates: []}; groups.push(g); }
    g.dates.push(d);
  });
  return groups;
}

let lastRekapPayload = null;

async function renderRekap(){
  refreshKelasSelects();
  const classId = document.getElementById('rekapKelas').value;
  const head = document.getElementById('rekapTableHead');
  const body = document.getElementById('rekapTableBody');
  const emptyMsg = document.getElementById('rekapEmptyMsg');
  head.innerHTML = ''; body.innerHTML = '';
  lastRekapPayload = null;

  if(!classId){ emptyMsg.hidden=false; emptyMsg.textContent='Buat kelas terlebih dahulu.'; document.getElementById('rekapStats').innerHTML=''; return; }

  const range = dateRangeFromInputs();
  if(!range){ emptyMsg.hidden=false; emptyMsg.textContent = 'Lengkapi pilihan semester/tahun ajaran di atas.'; return; }

  const semesterMode = document.getElementById('rekapModeSemester').checked;
  const byDate = await dbFetchAttendanceRange(classId, range.start, range.end);
  const dates = Object.keys(byDate).sort();
  const students = DATA.students.filter(s=>s.classId===classId).sort((a,b)=>a.nama.localeCompare(b.nama,'id'));

  if(!students.length || !dates.length){
    emptyMsg.hidden = false;
    emptyMsg.textContent = !students.length ? 'Belum ada siswa di kelas ini.' : 'Belum ada data presensi pada rentang tanggal ini.';
    document.getElementById('rekapStats').innerHTML = '';
    return;
  }
  emptyMsg.hidden = true;

  const monthGroups = semesterMode ? groupDatesByMonth(dates) : null;

  // header: mode biasa -> 1 baris (tanggal lengkap per kolom).
  // mode semester guru mapel -> 2 baris: nama bulan (colspan) lalu tanggal pertemuan di bawahnya,
  // karena guru mapel cuma masuk 1x/minggu jadi kolomnya otomatis cuma tanggal2 yang ada presensinya.
  // PENTING: `head` sekarang elemen <thead>, isi dengan appendChild(<tr>) yang valid (bukan innerHTML
  // berisi <tr> di dalam <tr> seperti sebelumnya, karena itu bikin browser "membetulkan" tabel sendiri).
  function dateHeaderCell(d, extraStyle){
    return `<th style="${extraStyle||'width:52px'}"><div class="date-th"><span title="${formatIndoDateFromStr(d)}">${semesterMode ? d.slice(8,10) : shortDate(d)}</span><button type="button" class="date-del-btn" data-tanggal="${d}" title="Hapus semua presensi tanggal ${formatIndoDateFromStr(d)}">✕</button></div></th>`;
  }
  if(semesterMode){
    const row1 = document.createElement('tr');
    row1.innerHTML = '<th rowspan="2" style="width:32px">No</th><th rowspan="2" style="min-width:140px">Nama Siswa</th>' +
      monthGroups.map(g=>`<th colspan="${g.dates.length}">${g.label}</th>`).join('') +
      '<th rowspan="2" style="width:36px">H</th><th rowspan="2" style="width:36px">S</th><th rowspan="2" style="width:36px">I</th><th rowspan="2" style="width:36px">A</th><th rowspan="2" style="width:56px">%Hadir</th>';
    const row2 = document.createElement('tr');
    row2.innerHTML = monthGroups.map(g=>g.dates.map(d=>dateHeaderCell(d,'width:36px')).join('')).join('');
    head.appendChild(row1); head.appendChild(row2);
  } else {
    const row = document.createElement('tr');
    row.innerHTML = '<th style="width:32px">No</th><th style="min-width:140px">Nama Siswa</th>' +
      dates.map(d=>dateHeaderCell(d)).join('') +
      '<th style="width:36px">H</th><th style="width:36px">S</th><th style="width:36px">I</th><th style="width:36px">A</th><th style="width:56px">%Hadir</th>';
    head.appendChild(row);
  }


  const classTotals = {H:0,S:0,I:0,A:0};
  const rowsData = [];

  students.forEach((s,i)=>{
    const tr = document.createElement('tr');
    const counts = {H:0,S:0,I:0,A:0};
    const cellMarks = [];
    const markTds = [];
    dates.forEach(d=>{
      const st = (byDate[d] || {})[s.id] || '-';
      if(counts[st]!==undefined) counts[st]++;
      cellMarks.push(st);
      const warna = st==='H'?'#1e8449':st==='S'?'#d68910':st==='I'?'#2471a3':st==='A'?'#c0392b':'#bbb';
      markTds.push(`<td class="mark-cell" data-siswa="${s.id}" data-tanggal="${d}" data-status="${st}" title="Klik untuk ubah/hapus" style="text-align:center;color:${warna}">${st}</td>`);
    });
    const totalTercatat = counts.H+counts.S+counts.I+counts.A;
    const pct = totalTercatat ? Math.round((counts.H/totalTercatat)*100) : 0;
    classTotals.H += counts.H; classTotals.S += counts.S; classTotals.I += counts.I; classTotals.A += counts.A;

    tr.innerHTML = `<td>${i+1}</td><td style="text-align:left">${escapeHtml(s.nama)}</td>` +
      markTds.join('') +
      `<td style="text-align:center">${counts.H}</td><td style="text-align:center">${counts.S}</td><td style="text-align:center">${counts.I}</td><td style="text-align:center">${counts.A}</td><td style="text-align:center">${pct}%</td>`;
    body.appendChild(tr);

    rowsData.push({no:i+1, nama:s.nama, marks:cellMarks, H:counts.H, S:counts.S, I:counts.I, A:counts.A, pct});
  });

  document.getElementById('rekapStats').innerHTML = `
    <div class="stat-box H"><b>${classTotals.H}</b><span>Total Hadir</span></div>
    <div class="stat-box S"><b>${classTotals.S}</b><span>Total Sakit</span></div>
    <div class="stat-box I"><b>${classTotals.I}</b><span>Total Izin</span></div>
    <div class="stat-box A"><b>${classTotals.A}</b><span>Tanpa Keterangan</span></div>
  `;

  lastRekapPayload = {
    classId,
    className: DATA.classes.find(k=>k.id===classId).nama,
    range, dates, rowsData, classTotals, semesterMode, monthGroups,
    semesterJenis: semesterMode ? document.getElementById('semesterJenis').value : null
  };
}

document.getElementById('rekapKelas').addEventListener('change', renderRekap);
document.getElementById('rekapBulan').addEventListener('change', renderRekap);
document.getElementById('rekapDari').addEventListener('change', renderRekap);
document.getElementById('rekapSampai').addEventListener('change', renderRekap);

/* ---------- REVIEW / EDIT / HAPUS DATA REKAP ---------- */
let editCtx = null;

function openEditPresensi(classId, siswaId, tanggal, status){
  const siswa = DATA.students.find(x=>x.id===siswaId);
  editCtx = { classId, siswaId, tanggal };
  document.getElementById('editPresensiSub').textContent = `${siswa ? siswa.nama : ''} — ${formatIndoDateFromStr(tanggal)}`;
  const wrap = document.getElementById('editPresensiBtns');
  wrap.innerHTML = '';
  ['H','S','I','A'].forEach(st=>{
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stbtn ' + st + (status===st ? ' sel' : '');
    b.textContent = st;
    b.title = STATUS_LABEL[st];
    b.addEventListener('click', async ()=>{
      const ok = await dbUpdateAttendanceStatus(editCtx.classId, editCtx.siswaId, editCtx.tanggal, st);
      closeEditPresensi();
      if(ok){ toast('Presensi diperbarui'); renderRekap(); }
    });
    wrap.appendChild(b);
  });
  document.getElementById('editPresensiHapus').hidden = (status === '-');
  document.getElementById('editPresensiOverlay').hidden = false;
}
function closeEditPresensi(){
  document.getElementById('editPresensiOverlay').hidden = true;
  editCtx = null;
}
document.getElementById('editPresensiBatal').addEventListener('click', closeEditPresensi);
document.getElementById('editPresensiOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'editPresensiOverlay') closeEditPresensi();
});
document.getElementById('editPresensiHapus').addEventListener('click', async ()=>{
  if(!editCtx) return;
  if(!confirm('Hapus data presensi siswa ini pada tanggal tersebut?')){ return; }
  const { classId, siswaId, tanggal } = editCtx;
  const ok = await dbDeleteAttendanceRecord(classId, siswaId, tanggal);
  closeEditPresensi();
  if(ok){ toast('Data presensi dihapus'); renderRekap(); }
});

// Klik pada sel tanggal (H/S/I/A/-) di tabel rekap -> buka dialog ubah/hapus.
document.getElementById('rekapTableBody').addEventListener('click', (e)=>{
  const cell = e.target.closest('.mark-cell');
  if(!cell) return;
  const classId = document.getElementById('rekapKelas').value;
  openEditPresensi(classId, cell.dataset.siswa, cell.dataset.tanggal, cell.dataset.status);
});

// Klik tombol ✕ di header tanggal -> hapus semua presensi kelas ini pada tanggal itu.
document.getElementById('rekapTableHead').addEventListener('click', async (e)=>{
  const btn = e.target.closest('.date-del-btn');
  if(!btn) return;
  const classId = document.getElementById('rekapKelas').value;
  if(!classId) return;
  const tanggal = btn.dataset.tanggal;
  if(!confirm(`Hapus SEMUA data presensi kelas ini pada tanggal ${formatIndoDateFromStr(tanggal)}? Tindakan ini tidak bisa dibatalkan.`)) return;
  const ok = await dbDeleteAttendanceForDate(classId, tanggal);
  if(ok){ toast('Data presensi tanggal tersebut dihapus'); renderRekap(); }
});

/* ============================ EXPORT CSV / EXCEL (per tanggal) ============================ */
document.getElementById('btnUnduhCsv').addEventListener('click', async ()=>{
  await renderRekap();
  if(!lastRekapPayload){ toast('Tidak ada data untuk diunduh'); return; }
  const p = lastRekapPayload;
  const s = DATA.settings;
  const rows = [];
  rows.push([s.namaSekolah]);
  rows.push([`Rekap Presensi Kelas: ${p.className}`]);
  rows.push([`Periode: ${formatIndoDateFromStr(p.range.start)} s.d. ${formatIndoDateFromStr(p.range.end)}`]);
  rows.push([]);
  if(p.semesterMode && p.monthGroups){
    const bulanRow = ['','']; 
    p.monthGroups.forEach(g=>{ bulanRow.push(g.label); for(let i=1;i<g.dates.length;i++) bulanRow.push(''); });
    bulanRow.push('','','','','');
    rows.push(bulanRow);
  }
  rows.push(['No','Nama Siswa', ...p.dates.map(formatIndoDateFromStr), 'H','S','I','A','%Hadir']);
  p.rowsData.forEach(r=>{
    rows.push([r.no, r.nama, ...r.marks, r.H, r.S, r.I, r.A, r.pct+'%']);
  });
  rows.push(['','REKAP KELAS', ...p.dates.map(()=>''), p.classTotals.H, p.classTotals.S, p.classTotals.I, p.classTotals.A, '']);

  const csv = rows.map(r=>r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'});
  const fname = `Rekap_Presensi_${p.className.replace(/\s+/g,'_')}_${p.range.start}_sd_${p.range.end}.csv`;
  downloadBlob(blob, fname);
  toast('Rekap CSV/Excel berhasil diunduh');
});

function csvEscape(v){
  const str = String(v ?? '');
  if(/[",\r\n]/.test(str)) return '"' + str.replace(/"/g,'""') + '"';
  return str;
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

/* ============================ PDF EXPORT (kop surat resmi) ============================ */
function formatIndoDate(dateObj){
  return dateObj.getDate() + ' ' + BULAN_ID[dateObj.getMonth()] + ' ' + dateObj.getFullYear();
}
function formatIndoDateFromStr(str){
  const [y,m,d] = str.split('-').map(Number);
  return d + ' ' + BULAN_ID[m-1] + ' ' + y;
}

/* Load a logo image as data URL for embedding into the PDF (canvas fetch) */
function getImageDataUrl(src){
  return new Promise((resolve)=>{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function(){
      try{
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      }catch(e){ resolve(null); }
    };
    img.onerror = function(){ resolve(null); };
    img.src = src;
  });
}

// Menggambar kop surat resmi (logo kiri/kanan + teks tengah + garis ganda) di posisi
// standar, dipakai bersama oleh PDF Rekap Presensi dan PDF Jurnal Harian supaya
// tampilannya selalu konsisten. Return: posisi Y setelah garis ganda (siap dipakai judul).
async function drawKopSurat(doc, pageWidth, s){
  const [logoBrebesUrl, logoSekolahUrl] = await Promise.all([
    getImageDataUrl('logo-brebes.png'),
    getImageDataUrl('logo.png')
  ]);
  const KOP_MARGIN = 40;
  const LOGO_SIZE = 62;
  if(logoBrebesUrl){
    try{ doc.addImage(logoBrebesUrl, 'PNG', KOP_MARGIN, 22, LOGO_SIZE, LOGO_SIZE); }catch(e){}
  }
  if(logoSekolahUrl){
    try{ doc.addImage(logoSekolahUrl, 'PNG', pageWidth-KOP_MARGIN-LOGO_SIZE, 22, LOGO_SIZE, LOGO_SIZE); }catch(e){}
  }
  const cx = pageWidth/2;
  doc.setFont('helvetica','bold'); doc.setFontSize(13.5);
  doc.text(s.pemerintah || 'PEMERINTAH KABUPATEN BREBES', cx, 30, {align:'center'});
  doc.setFontSize(12.5);
  doc.text(s.dinas || 'DINAS PENDIDIKAN PEMUDA DAN OLAHRAGA', cx, 43, {align:'center'});
  doc.setFontSize(11.5);
  doc.text(s.korwilcam || 'KORWILCAM SATPENDIK KECAMATAN TANJUNG', cx, 55, {align:'center'});
  doc.setFontSize(19);
  doc.text(s.namaSekolah || 'SD NEGERI TANJUNG 03', cx, 74, {align:'center'});
  doc.setFont('helvetica','bolditalic'); doc.setFontSize(9.5);
  doc.text(s.alamat || 'Alamat : Jl. Cendrawasih No. 54, Tanjung, Kec.Tanjung, Kab. Brebes, Prov.Jawa Tengah 52254', cx, 87, {align:'center'});

  doc.setLineWidth(1.6);
  doc.line(KOP_MARGIN, 97, pageWidth-KOP_MARGIN, 97);
  doc.setLineWidth(0.7);
  doc.line(KOP_MARGIN, 100.5, pageWidth-KOP_MARGIN, 100.5);
  return 100.5; // Y setelah garis ganda
}

// Membuat dokumen PDF rekap dari data terbaru. Dipakai baik oleh tombol "Unduh"
// maupun tombol "Kirim ke Google Drive" secara independen — masing-masing membuat
// PDF-nya sendiri, tidak saling bergantung.
async function buildRekapPdfDoc(){
  await renderRekap();
  if(!lastRekapPayload){ toast('Tidak ada data untuk dicetak'); return null; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'landscape', unit:'pt', format:'a4'});
  const pageWidth = doc.internal.pageSize.getWidth();
  const s = DATA.settings;
  const p = lastRekapPayload;

  await drawKopSurat(doc, pageWidth, s);
  const cx = pageWidth/2;
  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text(p.semesterMode ? `DAFTAR HADIR SEMESTER ${(p.semesterJenis||'ganjil').toUpperCase()} PJOK` : 'DAFTAR REKAP PRESENSI PESERTA DIDIK', cx, 117, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  const periodeTxt = `Kelas: ${p.className}   |   Periode: ${formatIndoDateFromStr(p.range.start)} s.d. ${formatIndoDateFromStr(p.range.end)}`;
  doc.text(periodeTxt, cx, 132, {align:'center'});

  // Table. Mode semester guru mapel -> header 2 baris (nama bulan lalu tanggal
  // pertemuan mingguan di bawahnya), karena kolomnya bisa sampai ~24 pertemuan (6 bulan).
  let head;
  if(p.semesterMode && p.monthGroups){
    head = [
      [
        {content:'No', rowSpan:2}, {content:'Nama Siswa', rowSpan:2},
        ...p.monthGroups.map(g=>({content:g.label, colSpan:g.dates.length})),
        {content:'H', rowSpan:2}, {content:'S', rowSpan:2}, {content:'I', rowSpan:2}, {content:'A', rowSpan:2}, {content:'%Hadir', rowSpan:2}
      ],
      p.monthGroups.flatMap(g=>g.dates.map(d=>d.slice(8,10)))
    ];
  } else {
    head = [['No','Nama Siswa', ...p.dates.map(shortDate), 'H','S','I','A','%Hadir']];
  }
  const rows = p.rowsData.map(r=>[r.no, r.nama, ...r.marks, r.H, r.S, r.I, r.A, r.pct+'%']);
  rows.push(['', 'REKAP KELAS', ...p.dates.map(()=>''), p.classTotals.H, p.classTotals.S, p.classTotals.I, p.classTotals.A, '']);

  // Banyak kolom (rekap semester bisa ~24 pertemuan) -> kecilkan font supaya tetap muat 1 halaman lebar.
  const fontSz = p.dates.length > 20 ? 6 : p.dates.length > 12 ? 7 : 7.5;

  doc.autoTable({
    startY: 145,
    head, body: rows,
    styles:{fontSize:fontSz, halign:'center', cellPadding:2, lineColor:[210,215,225], lineWidth:0.5},
    headStyles:{fillColor:[13,44,102], textColor:255, fontStyle:'bold'},
    columnStyles:{0:{cellWidth:20}, 1:{cellWidth:95, halign:'left'}},
    didParseCell: function(data){
      if(data.row.index === rows.length-1){
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [238,241,248];
      }
    },
    margin:{left:40, right:40}
  });

  let finalY = doc.lastAutoTable.finalY + 22;
  const pageH = doc.internal.pageSize.getHeight();
  if(finalY > pageH - 110){ doc.addPage('a4','landscape'); finalY = 50; }

  // Ringkasan
  doc.setFont('helvetica','bold'); doc.setFontSize(10);
  doc.text('Ringkasan:', 40, finalY);
  doc.setFont('helvetica','normal');
  const totalSemua = p.classTotals.H+p.classTotals.S+p.classTotals.I+p.classTotals.A;
  const pctKelas = totalSemua ? Math.round((p.classTotals.H/totalSemua)*100) : 0;
  doc.text(`Jumlah Siswa: ${p.rowsData.length}   |   Hadir: ${p.classTotals.H}   |   Sakit: ${p.classTotals.S}   |   Izin: ${p.classTotals.I}   |   Tanpa Keterangan: ${p.classTotals.A}   |   Rata-rata Kehadiran: ${pctKelas}%`, 40, finalY+15);

  // Tanda tangan
  const tglCetak = formatIndoDate(new Date());
  const signX = pageWidth - 220;
  let signY = finalY + 50;
  if(signY > pageH - 90){ doc.addPage('a4','landscape'); signY = 60; }
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  doc.text(`${s.tempat || 'Tanjung'}, ${tglCetak}`, signX, signY, {align:'left'});
  doc.text(`${s.mapel || 'Guru Penjasorkes'}`, signX, signY+15, {align:'left'});
  doc.setFont('helvetica','bold');
  doc.text(`${s.namaGuru || ''}`, signX, signY+70, {align:'left'});
  doc.setFont('helvetica','normal');
  doc.text(`NIP. ${s.nip || ''}`, signX, signY+85, {align:'left'});

  const fname = `Rekap_Presensi_${p.className.replace(/\s+/g,'_')}_${p.range.start}_sd_${p.range.end}.pdf`;
  return { doc, fname };
}

document.getElementById('btnUnduhPdf').addEventListener('click', async ()=>{
  const built = await buildRekapPdfDoc();
  if(!built) return;
  built.doc.save(built.fname);
  toast('PDF berhasil diunduh');
});

/* ============================ GOOGLE DRIVE (kredensial dari config.js) ============================ */
let gdriveToken = null;
let gdriveTokenClient = null;

function setGdriveStatus(text, connected){
  ['gdriveStatus','gdriveStatusRekap'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.textContent = id === 'gdriveStatusRekap' ? ('Google Drive: ' + text) : text;
    el.classList.toggle('connected', !!connected);
  });
}

// Meminta izin/token Google jika belum terhubung, mengembalikan Promise yang
// selesai begitu token didapat. Dipakai oleh tombol "Hubungkan Google Drive"
// maupun otomatis oleh tombol-tombol unggah supaya tidak perlu 2 langkah manual.
function ensureDriveConnected(){
  return new Promise((resolve, reject)=>{
    if(gdriveToken){ resolve(gdriveToken); return; }
    if(!GOOGLE_CLIENT_ID){ toast('GOOGLE_CLIENT_ID belum diisi di config.js'); reject(new Error('no client id')); return; }
    if(typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2){
      toast('Layanan Google belum siap. Pastikan aplikasi diakses via http/https dan koneksi internet aktif.');
      reject(new Error('google sdk not ready'));
      return;
    }
    try{
      gdriveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        // Catatan: scope penuh "drive" (bukan "drive.file") dipakai karena kita
        // mengunggah ke folder ID yang sudah ada (ditentukan manual di config.js),
        // bukan folder yang dibuat/dipilih lewat aplikasi ini. Dengan scope
        // "drive.file" saja, Google akan menolak permintaan menaruh file ke folder
        // yang belum pernah "dibuka" lewat aplikasi -> ini penyebab paling umum
        // upload gagal walau sudah "Terhubung".
        scope: 'https://www.googleapis.com/auth/drive',
        callback: (resp)=>{
          if(resp.error){
            toast('Gagal menghubungkan Google Drive: ' + resp.error);
            reject(new Error(resp.error));
            return;
          }
          gdriveToken = resp.access_token;
          setGdriveStatus('Terhubung ✔', true);
          toast('Berhasil terhubung ke Google Drive');
          resolve(gdriveToken);
        }
      });
      gdriveTokenClient.requestAccessToken();
    }catch(err){
      toast('Gagal memulai koneksi Google. Periksa GOOGLE_CLIENT_ID & pengaturan origin di Google Cloud Console.');
      reject(err);
    }
  });
}

document.getElementById('btnConnectDrive').addEventListener('click', ()=>{
  ensureDriveConnected().catch(()=>{});
});

async function uploadToDrive(filename, mimeType, dataStr, isBase64){
  if(!gdriveToken){ toast('Hubungkan Google Drive terlebih dahulu'); return null; }
  const boundary = 'presensi_boundary_' + Date.now();
  const metadata = { name: filename, mimeType };
  if(DRIVE_FOLDER_ID) metadata.parents = [DRIVE_FOLDER_ID];
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    (isBase64 ? `Content-Transfer-Encoding: base64\r\n` : ``) + `\r\n` +
    dataStr + `\r\n` +
    `--${boundary}--`;

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + gdriveToken,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });
  if(!res.ok){
    const errText = await res.text();
    throw new Error(`Upload gagal (${res.status}): ${errText}`);
  }
  return res.json();
}

// Ambil seluruh data langsung dari Supabase (bukan dari cache sesi) supaya backup JSON selalu lengkap & terbaru.
async function buildFullBackupJson(){
  const [kelasRes, siswaRes, presensiRes, pengaturanRes] = await Promise.all([
    sb.from('kelas').select('*'),
    sb.from('siswa').select('*'),
    sb.from('presensi').select('*'),
    sb.from('pengaturan').select('*').eq('id','main').maybeSingle()
  ]);
  if(kelasRes.error || siswaRes.error || presensiRes.error || pengaturanRes.error){
    throw new Error('Gagal mengambil data dari Supabase untuk backup');
  }
  const attendance = {};
  (presensiRes.data||[]).forEach(r=>{
    if(!attendance[r.kelas_id]) attendance[r.kelas_id] = {};
    if(!attendance[r.kelas_id][r.tanggal]) attendance[r.kelas_id][r.tanggal] = {};
    attendance[r.kelas_id][r.tanggal][r.siswa_id] = r.status;
  });
  return {
    classes: (kelasRes.data||[]).map(k=>({id:k.id, nama:k.nama})),
    students: (siswaRes.data||[]).map(s=>({id:s.id, classId:s.kelas_id, nama:s.nama})),
    attendance,
    settings: DATA.settings
  };
}

document.getElementById('btnUploadJsonDrive').addEventListener('click', async ()=>{
  try{
    await ensureDriveConnected();
    toast('Menyiapkan data & mengunggah backup ke Google Drive...');
    const backup = await buildFullBackupJson();
    const json = JSON.stringify(backup, null, 2);
    const stamp = todayStr();
    const fname = `Backup_Presensi_${(DATA.settings.namaSekolah||'Sekolah').replace(/\s+/g,'_')}_${stamp}.json`;
    const result = await uploadToDrive(fname, 'application/json', json, false);
    if(result) toast('Backup JSON berhasil diunggah ke Google Drive');
  }catch(err){
    if(err && err.message !== 'no client id' && err.message !== 'google sdk not ready') toast('Gagal mengunggah: ' + err.message);
  }
});

// Tombol "Kirim PDF ke Google Drive" di tab Rekap & Cetak — berdiri sendiri,
// TIDAK butuh tombol "Unduh Rekap PDF" diklik lebih dulu. PDF dibuat ulang di sini,
// dan jika belum terhubung ke Google, alur hubungkan-Google dijalankan dulu secara
// otomatis sebelum mengunggah.
document.getElementById('btnKirimPdfDrive').addEventListener('click', async ()=>{
  try{
    await ensureDriveConnected();
    toast('Membuat PDF rekap...');
    const built = await buildRekapPdfDoc();
    if(!built) return;
    toast('Mengunggah PDF ke Google Drive...');
    const dataUri = built.doc.output('datauristring');
    const base64 = dataUri.split(',')[1];
    const result = await uploadToDrive(built.fname, 'application/pdf', base64, true);
    if(result) toast('PDF rekap berhasil diunggah ke Google Drive');
  }catch(err){
    if(err && err.message !== 'no client id' && err.message !== 'google sdk not ready') toast('Gagal mengunggah: ' + err.message);
  }
});

/* ============================ INIT ============================ */
async function init(){
  toast('Memuat data dari server...');
  await Promise.all([dbFetchKelas(), dbFetchSiswa(), dbFetchSettings()]);
  renderKelasChips();
  renderSiswaList();
  refreshKelasSelects();
  await renderPresensi();
  await renderRekap();
  renderKopPreview();
  loadSettingsForm();
  document.getElementById('schoolSubTitle').textContent = 'Presensi Peserta Didik';
}

/* ============================ AUTH (LOGIN) ============================ */
const loginScreen = document.getElementById('loginScreen');
const appShell = document.getElementById('appShell');
const formLogin = document.getElementById('formLogin');
const loginError = document.getElementById('loginError');
const btnLoginSubmit = document.getElementById('btnLoginSubmit');
const btnLogout = document.getElementById('btnLogout');

let appInitialized = false;

function showLogin(){
  loginScreen.hidden = false;
  appShell.hidden = true;
}

async function showApp(){
  loginScreen.hidden = true;
  appShell.hidden = false;
  formLogin.reset();
  loginError.textContent = '';
  if(!appInitialized){
    appInitialized = true;
    await init();
  }
}

formLogin.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  loginError.textContent = '';
  btnLoginSubmit.disabled = true;
  btnLoginSubmit.textContent = 'Memproses...';
  try{
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error){
      console.error('Login error:', error);
      if(/confirm/i.test(error.message)){
        loginError.textContent = 'Email belum dikonfirmasi. Cek inbox/spam untuk link konfirmasi, atau minta admin mengonfirmasi akun di dashboard Supabase.';
      }else if(/invalid login credentials/i.test(error.message)){
        loginError.textContent = 'Email atau kata sandi salah. (' + error.message + ')';
      }else{
        loginError.textContent = 'Login gagal: ' + error.message;
      }
    }
  }catch(err){
    loginError.textContent = 'Gagal terhubung ke server. Periksa koneksi internet Anda.';
  }finally{
    btnLoginSubmit.disabled = false;
    btnLoginSubmit.textContent = 'Masuk';
  }
});

btnLogout.addEventListener('click', async ()=>{
  await sb.auth.signOut();
});

sb.auth.onAuthStateChange((_event, session)=>{
  if(session){ showApp(); } else { appInitialized = false; showLogin(); }
});

(async function bootstrapAuth(){
  const { data } = await sb.auth.getSession();
  if(data && data.session){ await showApp(); } else { showLogin(); }
})();
