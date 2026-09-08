/* ============================ DATA LAYER ============================ */
const STORAGE_KEY = "presensiSiswaData_v1";

function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return {
    classes: [],
    students: [],
    attendance: {},
    settings: {
      namaSekolah: "SD NEGERI TANJUNG 03",
      kabupaten: "KAB. BREBES",
      tempat: "Tanjung",
      mapel: "Guru Penjasorkes",
      namaGuru: "Wahyu Riski Maulana, S.Pd.,Gr.",
      nip: "199608032022211003"
    }
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
  saveData();
  toast('Presensi tersimpan');
});

/* ============================ SETTINGS ============================ */
function loadSettingsForm(){
  const s = DATA.settings;
  document.getElementById('setNamaSekolah').value = s.namaSekolah || '';
  document.getElementById('setKabupaten').value = s.kabupaten || '';
  document.getElementById('setTempat').value = s.tempat || '';
  document.getElementById('setMapel').value = s.mapel || '';
  document.getElementById('setNamaGuru').value = s.namaGuru || '';
  document.getElementById('setNip').value = s.nip || '';
}
loadSettingsForm();

document.getElementById('toggleSettingsRow').addEventListener('click', ()=>{
  const box = document.getElementById('settingsBox');
  box.hidden = !box.hidden;
  document.getElementById('settingsChevron').textContent = box.hidden ? 'Buka ▾' : 'Tutup ▴';
});

document.getElementById('btnSimpanSettings').addEventListener('click', ()=>{
  DATA.settings = {
    namaSekolah: document.getElementById('setNamaSekolah').value.trim() || 'SD NEGERI TANJUNG 03',
    kabupaten: document.getElementById('setKabupaten').value.trim() || 'KAB. BREBES',
    tempat: document.getElementById('setTempat').value.trim() || 'Tanjung',
    mapel: document.getElementById('setMapel').value.trim() || 'Guru Penjasorkes',
    namaGuru: document.getElementById('setNamaGuru').value.trim(),
    nip: document.getElementById('setNip').value.trim()
  };
  saveData();
  document.getElementById('schoolNameTitle').textContent = DATA.settings.namaSekolah;
  document.getElementById('schoolSubTitle').textContent = DATA.settings.kabupaten + ' · Presensi Peserta Didik';
  toast('Pengaturan disimpan');
});

/* ============================ REKAP ============================ */
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

  // header row
  const trh = document.createElement('tr');
  trh.innerHTML = '<th style="width:32px">No</th><th style="min-width:140px">Nama Siswa</th>' +
    dates.map(d=>`<th style="width:40px">${shortDate(d)}</th>`).join('') +
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

/* ============================ PDF EXPORT ============================ */
const BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function formatIndoDate(dateObj){
  return dateObj.getDate() + ' ' + BULAN_ID[dateObj.getMonth()] + ' ' + dateObj.getFullYear();
}
function formatIndoDateFromStr(str){
  const [y,m,d] = str.split('-').map(Number);
  return d + ' ' + BULAN_ID[m-1] + ' ' + y;
}

/* Load logo as data URL for embedding into the PDF (canvas fetch of logo.png) */
function getLogoDataUrl(){
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
    img.src = 'logo.png';
  });
}

document.getElementById('btnUnduhPdf').addEventListener('click', async ()=>{
  renderRekap();
  if(!lastRekapPayload){ toast('Tidak ada data untuk dicetak'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'landscape', unit:'pt', format:'a4'});
  const pageWidth = doc.internal.pageSize.getWidth();
  const s = DATA.settings;
  const p = lastRekapPayload;
  const logoDataUrl = await getLogoDataUrl();

  // Header / kop surat
  if(logoDataUrl){
    try{ doc.addImage(logoDataUrl, 'PNG', 40, 24, 50, 50); }catch(e){}
  }
  doc.setFont('helvetica','bold'); doc.setFontSize(14);
  doc.text(s.namaSekolah || 'SD NEGERI TANJUNG 03', pageWidth/2, 38, {align:'center'});
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.text(s.kabupaten || 'KAB. BREBES', pageWidth/2, 54, {align:'center'});
  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text('DAFTAR REKAP PRESENSI PESERTA DIDIK', pageWidth/2, 72, {align:'center'});
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  const periodeTxt = `Kelas: ${p.className}   |   Periode: ${formatIndoDateFromStr(p.range.start)} s.d. ${formatIndoDateFromStr(p.range.end)}`;
  doc.text(periodeTxt, pageWidth/2, 87, {align:'center'});
  doc.setLineWidth(1.2);
  doc.line(40, 96, pageWidth-40, 96);

  // Table
  const head = [['No','Nama Siswa', ...p.dates.map(shortDate), 'H','S','I','A','%Hadir']];
  const rows = p.rowsData.map(r=>[r.no, r.nama, ...r.marks, r.H, r.S, r.I, r.A, r.pct+'%']);
  rows.push(['', 'REKAP KELAS', ...p.dates.map(()=>''), p.classTotals.H, p.classTotals.S, p.classTotals.I, p.classTotals.A, '']);

  doc.autoTable({
    startY: 104,
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
  toast('PDF berhasil diunduh');
});

/* ============================ INIT ============================ */
renderKelasChips();
renderSiswaList();
refreshKelasSelects();
renderPresensi();
renderRekap();
document.getElementById('schoolNameTitle').textContent = DATA.settings.namaSekolah;
document.getElementById('schoolSubTitle').textContent = DATA.settings.kabupaten + ' · Presensi Peserta Didik';
