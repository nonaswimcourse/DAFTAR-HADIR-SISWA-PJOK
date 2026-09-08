/* ============================ DATA LAYER ============================ */
const STORAGE_KEY = "presensiSiswaData_v1";

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
    nip: "199608032022211003",
    googleClientId: ""
  };
}

function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      // migrasi: lengkapi field pengaturan baru jika belum ada (data lama)
      parsed.settings = Object.assign(defaultSettings(), parsed.settings || {});
      if(!parsed.attendance) parsed.attendance = {};
      if(!parsed.classes) parsed.classes = [];
      if(!parsed.students) parsed.students = [];
      return parsed;
    }
  }catch(e){}
  return {
    classes: [],
    students: [],
    attendance: {},
    settings: defaultSettings()
  };
}
let DATA = loadData();
function saveData(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA)); }

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(()=>t.classList.remove('show'), 2200);
}

/* ============================ NAV ============================ */
document.querySelectorAll('nav.tabs .tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('nav.tabs .tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('main .page').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.page).classList.add('active');
    if(btn.dataset.page === 'presensi') renderPresensi();
    if(btn.dataset.page === 'rekap') renderRekap();
  });
});

/* ============================ KELAS ============================ */
let kelasAktifId = null;

function renderKelasChips(){
  const wrap = document.getElementById('daftarKelasChip');
  const empty = document.getElementById('kelasEmptyMsg');
  wrap.innerHTML = '';
  if(DATA.classes.length === 0){ empty.hidden = false; }
  else{ empty.hidden = true; }
  if(kelasAktifId && !DATA.classes.find(k=>k.id===kelasAktifId)) kelasAktifId = null;
  if(!kelasAktifId && DATA.classes.length) kelasAktifId = DATA.classes[0].id;

  DATA.classes.forEach(k=>{
    const chip = document.createElement('div');
    chip.className = 'chip' + (k.id===kelasAktifId ? ' active' : '');
    chip.innerHTML = `<span>${escapeHtml(k.nama)}</span><span class="del" data-del="${k.id}">✕</span>`;
    chip.addEventListener('click', (e)=>{
      if(e.target.dataset.del) return;
      kelasAktifId = k.id;
      renderKelasChips();
      renderSiswaList();
    });
    chip.querySelector('.del').addEventListener('click', (e)=>{
      e.stopPropagation();
      if(confirm(`Hapus kelas "${k.nama}"? Semua data siswa & presensi di kelas ini juga akan terhapus.`)){
        DATA.classes = DATA.classes.filter(c=>c.id!==k.id);
        DATA.students = DATA.students.filter(s=>s.classId!==k.id);
        delete DATA.attendance[k.id];
        saveData();
        renderKelasChips();
        renderSiswaList();
        refreshKelasSelects();
      }
    });
    wrap.appendChild(chip);
  });

  document.getElementById('kelasAktifLabel').textContent = kelasAktifId
    ? '- ' + DATA.classes.find(k=>k.id===kelasAktifId).nama : '';
}

document.getElementById('formKelas').addEventListener('submit', (e)=>{
  e.preventDefault();
  const inp = document.getElementById('inputKelasNama');
  const nama = inp.value.trim();
  if(!nama) return;
  const kelas = {id: uid(), nama};
  DATA.classes.push(kelas);
  kelasAktifId = kelas.id;
  saveData();
  inp.value = '';
  renderKelasChips();
  renderSiswaList();
  refreshKelasSelects();
  toast('Kelas ditambahkan');
});

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

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
    tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(s.nama)}</td>
      <td><button class="btn danger sm" data-del="${s.id}">Hapus</button></td>`;
    tr.querySelector('[data-del]').addEventListener('click', ()=>{
      if(confirm(`Hapus siswa "${s.nama}"?`)){
        DATA.students = DATA.students.filter(x=>x.id!==s.id);
        saveData();
        renderSiswaList();
      }
    });
    tbody.appendChild(tr);
  });
}

document.getElementById('formSiswa').addEventListener('submit', (e)=>{
  e.preventDefault();
  if(!kelasAktifId){ toast('Pilih kelas terlebih dahulu'); return; }
  const inp = document.getElementById('inputSiswaNama');
  const nama = inp.value.trim();
  if(!nama) return;
  DATA.students.push({id: uid(), classId: kelasAktifId, nama});
  saveData();
  inp.value='';
  renderSiswaList();
});

document.getElementById('importSiswaBtn').addEventListener('click', ()=>{
  if(!kelasAktifId){ toast('Pilih kelas terlebih dahulu'); return; }
  const ta = document.getElementById('importSiswaText');
  const lines = ta.value.split('\n').map(x=>x.trim()).filter(Boolean);
  if(!lines.length) return;
  lines.forEach(nama=>{
    DATA.students.push({id: uid(), classId: kelasAktifId, nama});
  });
  saveData();
  ta.value = '';
  renderSiswaList();
  toast(`${lines.length} siswa ditambahkan`);
});

/* ============================ SELECT REFRESH ============================ */
function refreshKelasSelects(){
  ['presensiKelas','rekapKelas'].forEach(id=>{
    const sel = document.getElementById(id);
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

function getAttendanceRecord(classId, date){
  if(!DATA.attendance[classId]) DATA.attendance[classId] = {};
  if(!DATA.attendance[classId][date]) DATA.attendance[classId][date] = {};
  return DATA.attendance[classId][date];
}

function renderPresensi(){
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

  const record = getAttendanceRecord(classId, date);

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

document.getElementById('btnSemuaHadir').addEventListener('click', ()=>{
  const classId = document.getElementById('presensiKelas').value;
  const date = document.getElementById('presensiTanggal').value || todayStr();
  if(!classId) return;
  const list = DATA.students.filter(s=>s.classId===classId);
  const record = getAttendanceRecord(classId, date);
  list.forEach(s=> record[s.id] = 'H');
  renderPresensi();
  toast('Semua siswa ditandai Hadir');
});

document.getElementById('btnSimpanPresensi').addEventListener('click', ()=>{
  const classId = document.getElementById('presensiKelas').value;
  if(!classId){ toast('Pilih kelas terlebih dahulu'); return; }
  const date = document.getElementById('presensiTanggal').value || todayStr();
  saveData();
  toast(`Presensi tanggal ${formatIndoDateFromStr(date)} tersimpan`);
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
  document.getElementById('setGoogleClientId').value = s.googleClientId || '';
}
loadSettingsForm();

document.getElementById('toggleSettingsRow').addEventListener('click', ()=>{
  const box = document.getElementById('settingsBox');
  box.hidden = !box.hidden;
  document.getElementById('settingsChevron').textContent = box.hidden ? 'Buka ▾' : 'Tutup ▴';
});

document.getElementById('btnSimpanSettings').addEventListener('click', ()=>{
  DATA.settings = Object.assign({}, DATA.settings, {
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
  saveData();
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

function dateRangeFromInputs(){
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

// Semua tanggal presensi yang benar-benar tersimpan (bukan cuma total), diurutkan kronologis
function getSortedDatesInRange(classId, start, end){
  const rec = DATA.attendance[classId] || {};
  return Object.keys(rec).filter(d=> d>=start && d<=end).sort();
}

function shortDate(d){
  const [y,m,day] = d.split('-');
  return day+'/'+m;
}

let lastRekapPayload = null;

function renderRekap(){
  refreshKelasSelects();
  const classId = document.getElementById('rekapKelas').value;
  const head = document.getElementById('rekapTableHead');
  const body = document.getElementById('rekapTableBody');
  const emptyMsg = document.getElementById('rekapEmptyMsg');
  head.innerHTML = ''; body.innerHTML = '';
  lastRekapPayload = null;

  if(!classId){ emptyMsg.hidden=false; emptyMsg.textContent='Buat kelas terlebih dahulu.'; document.getElementById('rekapStats').innerHTML=''; return; }

  const range = dateRangeFromInputs();
  if(!range){ emptyMsg.hidden=false; return; }

  const dates = getSortedDatesInRange(classId, range.start, range.end);
  const students = DATA.students.filter(s=>s.classId===classId).sort((a,b)=>a.nama.localeCompare(b.nama,'id'));

  if(!students.length || !dates.length){
    emptyMsg.hidden = false;
    emptyMsg.textContent = !students.length ? 'Belum ada siswa di kelas ini.' : 'Belum ada data presensi pada rentang tanggal ini.';
    document.getElementById('rekapStats').innerHTML = '';
    return;
  }
  emptyMsg.hidden = true;

  // header row: setiap tanggal presensi tampil sebagai kolomnya sendiri
  const trh = document.createElement('tr');
  trh.innerHTML = '<th style="width:32px">No</th><th style="min-width:140px">Nama Siswa</th>' +
    dates.map(d=>`<th style="width:40px" title="${formatIndoDateFromStr(d)}">${shortDate(d)}</th>`).join('') +
    '<th style="width:40px">H</th><th style="width:40px">S</th><th style="width:40px">I</th><th style="width:40px">A</th><th style="width:50px">%Hadir</th>';
  head.appendChild(trh);

  const classTotals = {H:0,S:0,I:0,A:0};
  const rowsData = [];

  students.forEach((s,i)=>{
    const tr = document.createElement('tr');
    const counts = {H:0,S:0,I:0,A:0};
    const cellMarks = [];
    dates.forEach(d=>{
      const st = (DATA.attendance[classId][d] || {})[s.id] || '-';
      if(counts[st]!==undefined) counts[st]++;
      cellMarks.push(st);
    });
    const totalTercatat = counts.H+counts.S+counts.I+counts.A;
    const pct = totalTercatat ? Math.round((counts.H/totalTercatat)*100) : 0;
    classTotals.H += counts.H; classTotals.S += counts.S; classTotals.I += counts.I; classTotals.A += counts.A;

    tr.innerHTML = `<td>${i+1}</td><td style="text-align:left">${escapeHtml(s.nama)}</td>` +
      cellMarks.map(m=>`<td style="text-align:center;color:${m==='H'?'#1e8449':m==='S'?'#d68910':m==='I'?'#2471a3':m==='A'?'#c0392b':'#bbb'}">${m}</td>`).join('') +
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
    range, dates, rowsData, classTotals
  };
}

document.getElementById('rekapKelas').addEventListener('change', renderRekap);
document.getElementById('rekapBulan').addEventListener('change', renderRekap);
document.getElementById('rekapDari').addEventListener('change', renderRekap);
document.getElementById('rekapSampai').addEventListener('change', renderRekap);

/* ============================ EXPORT CSV / EXCEL (per tanggal) ============================ */
document.getElementById('btnUnduhCsv').addEventListener('click', ()=>{
  renderRekap();
  if(!lastRekapPayload){ toast('Tidak ada data untuk diunduh'); return; }
  const p = lastRekapPayload;
  const s = DATA.settings;
  const rows = [];
  rows.push([s.namaSekolah]);
  rows.push([`Rekap Presensi Kelas: ${p.className}`]);
  rows.push([`Periode: ${formatIndoDateFromStr(p.range.start)} s.d. ${formatIndoDateFromStr(p.range.end)}`]);
  rows.push([]);
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
const BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
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

let lastPdfDoc = null;
let lastPdfFilename = null;

document.getElementById('btnUnduhPdf').addEventListener('click', async ()=>{
  renderRekap();
  if(!lastRekapPayload){ toast('Tidak ada data untuk dicetak'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'landscape', unit:'pt', format:'a4'});
  const pageWidth = doc.internal.pageSize.getWidth();
  const s = DATA.settings;
  const p = lastRekapPayload;
  const [logoBrebesUrl, logoSekolahUrl] = await Promise.all([
    getImageDataUrl('logo-brebes.png'),
    getImageDataUrl('logo.png')
  ]);

  // ===== KOP SURAT RESMI (Logo Brebes kiri / teks tengah / Logo Sekolah kanan + garis ganda) =====
  if(logoBrebesUrl){
    try{ doc.addImage(logoBrebesUrl, 'PNG', 40, 20, 56, 56); }catch(e){}
  }
  if(logoSekolahUrl){
    try{ doc.addImage(logoSekolahUrl, 'PNG', pageWidth-96, 20, 56, 56); }catch(e){}
  }
  const cx = pageWidth/2;
  doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text(s.pemerintah || 'PEMERINTAH KABUPATEN BREBES', cx, 30, {align:'center'});
  doc.setFontSize(12);
  doc.text(s.dinas || 'DINAS PENDIDIKAN PEMUDA DAN OLAHRAGA', cx, 44, {align:'center'});
  doc.text(s.korwilcam || 'KORWILCAM SATPENDIK KECAMATAN TANJUNG', cx, 58, {align:'center'});
  doc.setFontSize(17);
  doc.text(s.namaSekolah || 'SD NEGERI TANJUNG 03', cx, 76, {align:'center'});
  doc.setFont('helvetica','bolditalic'); doc.setFontSize(9.5);
  doc.text(s.alamat || 'Alamat : Jl. Cendrawasih No. 54, Tanjung, Kec.Tanjung, Kab. Brebes, Prov.Jawa Tengah 52254', cx, 89, {align:'center'});

  // garis ganda kop surat (tebal lalu tipis)
  doc.setLineWidth(1.6);
  doc.line(40, 98, pageWidth-40, 98);
  doc.setLineWidth(0.7);
  doc.line(40, 101.5, pageWidth-40, 101.5);

  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text('DAFTAR REKAP PRESENSI PESERTA DIDIK', cx, 116, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  const periodeTxt = `Kelas: ${p.className}   |   Periode: ${formatIndoDateFromStr(p.range.start)} s.d. ${formatIndoDateFromStr(p.range.end)}`;
  doc.text(periodeTxt, cx, 131, {align:'center'});

  // Table
  const head = [['No','Nama Siswa', ...p.dates.map(shortDate), 'H','S','I','A','%Hadir']];
  const rows = p.rowsData.map(r=>[r.no, r.nama, ...r.marks, r.H, r.S, r.I, r.A, r.pct+'%']);
  rows.push(['', 'REKAP KELAS', ...p.dates.map(()=>''), p.classTotals.H, p.classTotals.S, p.classTotals.I, p.classTotals.A, '']);

  doc.autoTable({
    startY: 142,
    head, body: rows,
    styles:{fontSize:7.5, halign:'center', cellPadding:2.5, lineColor:[210,215,225], lineWidth:0.5},
    headStyles:{fillColor:[13,44,102], textColor:255, fontStyle:'bold'},
    columnStyles:{0:{cellWidth:22}, 1:{cellWidth:100, halign:'left'}},
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
  doc.save(fname);
  lastPdfDoc = doc;
  lastPdfFilename = fname;
  toast('PDF berhasil diunduh');
});

/* ============================ BACKUP: DOWNLOAD / RESTORE (JSON) ============================ */
document.getElementById('btnDownloadBackup').addEventListener('click', ()=>{
  const json = JSON.stringify(DATA, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const stamp = todayStr();
  downloadBlob(blob, `Backup_Presensi_${(DATA.settings.namaSekolah||'Sekolah').replace(/\s+/g,'_')}_${stamp}.json`);
  toast('Backup JSON diunduh. Unggah file ini ke Google Drive Anda.');
});

document.getElementById('inputRestoreBackup').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      if(!parsed.classes || !parsed.students || !parsed.attendance){
        toast('File backup tidak valid'); return;
      }
      if(!confirm('Memulihkan backup akan menimpa data yang ada saat ini di aplikasi. Lanjutkan?')) return;
      parsed.settings = Object.assign(defaultSettings(), parsed.settings || {});
      DATA = parsed;
      saveData();
      kelasAktifId = null;
      renderKelasChips(); renderSiswaList(); refreshKelasSelects();
      renderPresensi(); renderRekap(); loadSettingsForm(); renderKopPreview();
      toast('Data berhasil dipulihkan dari backup');
    }catch(err){
      toast('Gagal membaca file backup');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

/* ============================ GOOGLE DRIVE (opsional) ============================ */
let gdriveToken = null;
let gdriveTokenClient = null;

document.getElementById('toggleGdriveRow').addEventListener('click', ()=>{
  const box = document.getElementById('gdriveBox');
  box.hidden = !box.hidden;
  document.getElementById('gdriveChevron').textContent = box.hidden ? 'Buka ▾' : 'Tutup ▴';
});

document.getElementById('btnSimpanClientId').addEventListener('click', ()=>{
  DATA.settings.googleClientId = document.getElementById('setGoogleClientId').value.trim();
  saveData();
  toast('Google Client ID disimpan');
});

document.getElementById('btnConnectDrive').addEventListener('click', ()=>{
  const clientId = (document.getElementById('setGoogleClientId').value || DATA.settings.googleClientId || '').trim();
  if(!clientId){ toast('Isi & simpan Google Client ID terlebih dahulu'); return; }
  if(typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2){
    toast('Layanan Google belum siap. Pastikan aplikasi diakses via http/https dan koneksi internet aktif.');
    return;
  }
  DATA.settings.googleClientId = clientId;
  saveData();
  try{
    gdriveTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (resp)=>{
        if(resp.error){
          toast('Gagal menghubungkan Google Drive: ' + resp.error);
          return;
        }
        gdriveToken = resp.access_token;
        const statusEl = document.getElementById('gdriveStatus');
        statusEl.textContent = 'Terhubung ✔';
        statusEl.classList.add('connected');
        toast('Berhasil terhubung ke Google Drive');
      }
    });
    gdriveTokenClient.requestAccessToken();
  }catch(err){
    toast('Gagal memulai koneksi Google. Periksa Client ID & pengaturan origin di Google Cloud Console.');
  }
});

async function uploadToDrive(filename, mimeType, dataStr, isBase64){
  if(!gdriveToken){ toast('Hubungkan Google Drive terlebih dahulu'); return null; }
  const boundary = 'presensi_boundary_' + Date.now();
  const metadata = { name: filename, mimeType };
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

document.getElementById('btnUploadJsonDrive').addEventListener('click', async ()=>{
  try{
    const json = JSON.stringify(DATA, null, 2);
    const stamp = todayStr();
    const fname = `Backup_Presensi_${(DATA.settings.namaSekolah||'Sekolah').replace(/\s+/g,'_')}_${stamp}.json`;
    toast('Mengunggah backup ke Google Drive...');
    const result = await uploadToDrive(fname, 'application/json', json, false);
    if(result) toast('Backup JSON berhasil diunggah ke Google Drive');
  }catch(err){
    toast('Gagal mengunggah: ' + err.message);
  }
});

document.getElementById('btnUploadPdfDrive').addEventListener('click', async ()=>{
  if(!lastPdfDoc){ toast('Buat dahulu PDF-nya di tab "Rekap & Cetak"'); return; }
  try{
    toast('Mengunggah PDF ke Google Drive...');
    const dataUri = lastPdfDoc.output('datauristring');
    const base64 = dataUri.split(',')[1];
    const result = await uploadToDrive(lastPdfFilename || 'Rekap_Presensi.pdf', 'application/pdf', base64, true);
    if(result) toast('PDF rekap berhasil diunggah ke Google Drive');
  }catch(err){
    toast('Gagal mengunggah: ' + err.message);
  }
});

/* ============================ INIT ============================ */
renderKelasChips();
renderSiswaList();
refreshKelasSelects();
renderPresensi();
renderRekap();
renderKopPreview();
document.getElementById('schoolSubTitle').textContent = 'Presensi Peserta Didik';
