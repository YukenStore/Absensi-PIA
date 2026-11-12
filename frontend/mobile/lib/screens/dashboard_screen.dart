import 'package:flutter/material.dart';

class DashboardScreen extends StatefulWidget {
  final String userName;
  final String userEmail;

  const DashboardScreen({
    super.key,
    this.userName = 'Yuken',
    this.userEmail = 'yumenoboken@gmail.com',
  });

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  static const List<String> _monthNames = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];

  static const List<String> _dayShort = [
    'Min',
    'Sen',
    'Sel',
    'Rab',
    'Kam',
    'Jum',
    'Sab',
  ];

  static const List<int> _years = [2024, 2025, 2026, 2027];

  // Data siswa bersih (diisi melalui menu Pendaftaran Siswa)
  final List<Map<String, dynamic>> _students = [];

  // Data guru sesuai akun yang mendaftar (dapat di-hide oleh Admin)
  final List<Map<String, dynamic>> _allTeachers = [
    {
      'id': 1,
      'name': 'Yuken',
      'email': 'yumenoboken@gmail.com',
      'is_hidden': false,
    },
  ];

  List<Map<String, dynamic>> get _visibleTeachers =>
      _allTeachers.where((t) => t['is_hidden'] != true).toList();

  // Rekaman presensi riil (kosong sebelum absensi diisi)
  final Map<String, String> _studentRecords = {};
  final Map<String, String> _teacherRecords = {};

  // Filter Tab Siswa (Dibedakan antara Tabel Harian & Rekap Absensi)
  int _siswaDailyMonth = DateTime.now().month - 1;
  int _siswaDailyYear = 2026;

  String _siswaRecapMode = 'all'; // 'all' | 'year' | 'month'
  int _siswaRecapMonth = DateTime.now().month - 1;
  int _siswaRecapYear = 2026;

  // Filter Master Tab Guru (1 Dropdown Bulan & Tahun untuk Harian + Rekap)
  int _guruMasterMonth = DateTime.now().month - 1;
  int _guruMasterYear = 2026;

  final Map<String, bool> _customHolidays = {};

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  int _daysInMonth(int year, int monthIndex) {
    return DateTime(year, monthIndex + 2, 0).day;
  }

  String _dateKey(int year, int monthIndex, int day) {
    final m = (monthIndex + 1).toString().padLeft(2, '0');
    final d = day.toString().padLeft(2, '0');
    return '$year-$m-$d';
  }

  bool _isHoliday(int year, int monthIndex, int day) {
    final key = _dateKey(year, monthIndex, day);
    if (_customHolidays.containsKey(key)) {
      return _customHolidays[key]!;
    }
    final weekday = DateTime(year, monthIndex + 1, day).weekday;
    return weekday == DateTime.saturday; // Sabtu otomatis libur
  }

  void _toggleHoliday(int year, int monthIndex, int day) {
    final key = _dateKey(year, monthIndex, day);
    final current = _isHoliday(year, monthIndex, day);
    setState(() {
      _customHolidays[key] = !current;
    });
  }

  String? _getStatus(
    int personId,
    int year,
    int monthIndex,
    int day, {
    required bool isTeacher,
  }) {
    final key = '${personId}_${_dateKey(year, monthIndex, day)}';
    final existing = isTeacher ? _teacherRecords[key] : _studentRecords[key];
    if (existing != null && existing.isNotEmpty) {
      return existing;
    }
    // Jika guru dan tidak mengisi absen pada hari aktif sampai hari ini: otomatis Alfa (A)
    if (isTeacher && !_isHoliday(year, monthIndex, day)) {
      final targetDate = DateTime(year, monthIndex + 1, day);
      final now = DateTime.now();
      final todayDate = DateTime(now.year, now.month, now.day);
      if (!targetDate.isAfter(todayDate)) {
        return 'A'; // Otomatis Alfa jika tidak mengisi absen
      }
    }
    return null;
  }

  Color _statusBgColor(String status) {
    switch (status) {
      case 'H':
        return const Color(0xFF10B981); // Hijau Hadir
      case 'S':
      case 'I':
        return const Color(0xFFF59E0B); // Oranye Sakit/Izin
      case 'A':
        return const Color(0xFFEF4444); // Merah Alfa
      case 'L':
        return const Color(0xFFE2E8F0); // Abu-abu Libur
      default:
        return Colors.transparent;
    }
  }

  // Modal Pendaftaran Siswa (Nama Siswa, Kelas 1-12, Tanggal Lahir)
  void _openPendaftaranDialog() {
    final nameCtrl = TextEditingController();
    String selectedClass = 'Kelas 1';
    final birthDateCtrl = TextEditingController();
    final classOptions = List.generate(12, (idx) => 'Kelas ${idx + 1}');

    showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            return AlertDialog(
              title: const Text(
                'Pendaftaran Data Siswa',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: nameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Nama Lengkap Siswa',
                        hintText: 'Contoh: Ahmad Fauzan',
                      ),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: selectedClass,
                      decoration: const InputDecoration(
                        labelText: 'Kelas',
                      ),
                      items: classOptions
                          .map(
                            (cls) => DropdownMenuItem(
                              value: cls,
                              child: Text(cls),
                            ),
                          )
                          .toList(),
                      onChanged: (v) {
                        if (v != null) {
                          setModalState(() => selectedClass = v);
                        }
                      },
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: birthDateCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Tanggal Lahir (YYYY-MM-DD)',
                        hintText: 'Contoh: 2018-05-14',
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: const Text('Batal'),
                ),
                ElevatedButton(
                  onPressed: () {
                    final name = nameCtrl.text.trim();
                    final dob = birthDateCtrl.text.trim();
                    if (name.isEmpty || dob.isEmpty) return;

                    setState(() {
                      _students.add({
                        'id': _students.length + 1,
                        'name': name,
                        'class_name': selectedClass,
                        'birth_date': dob,
                      });
                    });
                    Navigator.of(ctx).pop();
                  },
                  child: const Text('Simpan ke Dashboard'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  // Modal Khusus Admin untuk Hide / Show Nama User di Tabel Guru
  void _openManageTeachersVisibilityDialog() {
    showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            return AlertDialog(
              title: const Text(
                'Sembunyikan / Tampilkan Nama User',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              content: SizedBox(
                width: double.maxFinite,
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: _allTeachers.length,
                  itemBuilder: (_, idx) {
                    final t = _allTeachers[idx];
                    final isHidden = t['is_hidden'] == true;
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        t['name'].toString(),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      subtitle: Text(t['email']?.toString() ?? ''),
                      trailing: Switch(
                        value: !isHidden,
                        onChanged: (showInTable) {
                          setState(() {
                            t['is_hidden'] = !showInTable;
                          });
                          setModalState(() {});
                        },
                      ),
                    );
                  },
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: const Text('Selesai'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Widget _buildDailyMatrix({
    required List<Map<String, dynamic>> people,
    required int year,
    required int monthIndex,
    required bool isTeacher,
  }) {
    if (people.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Column(
          children: [
            Text(
              isTeacher
                  ? 'Belum ada nama guru yang ditampilkan pada tabel.'
                  : 'Belum ada data siswa terdaftar di Dashboard.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF64748B)),
            ),
            if (!isTeacher) ...[
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: _openPendaftaranDialog,
                icon: const Icon(Icons.person_add_alt_1, size: 18),
                label: const Text('Pendaftaran Siswa Baru'),
              ),
            ],
          ],
        ),
      );
    }

    final daysCount = _daysInMonth(year, monthIndex);

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        headingRowColor: WidgetStateProperty.all(const Color(0xFFF8FAFC)),
        columnSpacing: 12,
        horizontalMargin: 12,
        columns: [
          const DataColumn(
            label: Text('No', style: TextStyle(fontWeight: FontWeight.w700)),
          ),
          DataColumn(
            label: Text(
              isTeacher ? 'Nama Guru' : 'Nama Siswa',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
          ...List.generate(daysCount, (idx) {
            final d = idx + 1;
            final dow = DateTime(year, monthIndex + 1, d).weekday % 7;
            final hol = _isHoliday(year, monthIndex, d);
            return DataColumn(
              label: InkWell(
                onTap: () => _toggleHoliday(year, monthIndex, d),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      '$d',
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        color: hol
                            ? const Color(0xFFDC2626)
                            : const Color(0xFF0F172A),
                      ),
                    ),
                    Text(
                      hol ? 'Libur' : _dayShort[dow],
                      style: TextStyle(
                        fontSize: 10,
                        color: hol
                            ? const Color(0xFFDC2626)
                            : const Color(0xFF64748B),
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
        ],
        rows: List.generate(people.length, (i) {
          final p = people[i];
          final id = p['id'] as int;
          return DataRow(
            cells: [
              DataCell(Text('${i + 1}')),
              DataCell(
                Text(
                  p['name'].toString(),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
              ...List.generate(daysCount, (idx) {
                final d = idx + 1;
                final hol = _isHoliday(year, monthIndex, d);
                final st = hol
                    ? 'L'
                    : _getStatus(
                        id,
                        year,
                        monthIndex,
                        d,
                        isTeacher: isTeacher,
                      );
                if (st == null) {
                  return const DataCell(
                    Center(
                      child: Text(
                        '-',
                        style: TextStyle(
                          color: Color(0xFF94A3B8),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  );
                }
                return DataCell(
                  Container(
                    width: 28,
                    height: 28,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: _statusBgColor(st),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      st,
                      style: TextStyle(
                        color: st == 'L'
                            ? const Color(0xFF64748B)
                            : Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                      ),
                    ),
                  ),
                );
              }),
            ],
          );
        }),
      ),
    );
  }

  Widget _buildRecapTable({
    required List<Map<String, dynamic>> people,
    required String mode,
    required int year,
    required int monthIndex,
    required bool isTeacher,
  }) {
    if (people.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: Text(
            'Belum ada data untuk direkap.',
            style: TextStyle(color: Color(0xFF64748B)),
          ),
        ),
      );
    }

    final List<Map<String, int>> periods = [];
    if (mode == 'all') {
      for (final y in [2025, 2026]) {
        for (int m = 0; m < 12; m++) {
          periods.add({'year': y, 'month': m});
        }
      }
    } else if (mode == 'year') {
      for (int m = 0; m < 12; m++) {
        periods.add({'year': year, 'month': m});
      }
    } else {
      periods.add({'year': year, 'month': monthIndex});
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        headingRowColor: WidgetStateProperty.all(const Color(0xFFF8FAFC)),
        columns: [
          const DataColumn(label: Text('No')),
          DataColumn(label: Text(isTeacher ? 'Nama Guru' : 'Nama Siswa')),
          const DataColumn(label: Text('Hadir')),
          const DataColumn(label: Text('Izin / Sakit')),
          const DataColumn(label: Text('Alfa')),
          const DataColumn(label: Text('Persentase')),
        ],
        rows: List.generate(people.length, (i) {
          final p = people[i];
          final id = p['id'] as int;
          int hadir = 0;
          int sakit = 0;
          int alfa = 0;
          int effective = 0;

          for (final pr in periods) {
            final y = pr['year']!;
            final m = pr['month']!;
            final days = _daysInMonth(y, m);
            for (int d = 1; d <= days; d++) {
              if (_isHoliday(y, m, d)) continue;
              effective++;
              final st = _getStatus(id, y, m, d, isTeacher: isTeacher);
              if (st == 'H') {
                hadir++;
              } else if (st == 'S' || st == 'I') {
                sakit++;
              } else if (st == 'A') {
                alfa++;
              }
            }
          }

          final pct = effective > 0 ? ((hadir * 100) / effective).round() : 0;

          return DataRow(
            cells: [
              DataCell(Text('${i + 1}')),
              DataCell(
                Text(
                  p['name'].toString(),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
              DataCell(Text('$hadir', style: const TextStyle(color: Color(0xFF065F46), fontWeight: FontWeight.w700))),
              DataCell(Text('$sakit', style: const TextStyle(color: Color(0xFF92400E), fontWeight: FontWeight.w700))),
              DataCell(Text('$alfa', style: const TextStyle(color: Color(0xFF991B1B), fontWeight: FontWeight.w700))),
              DataCell(Text('$pct%', style: const TextStyle(fontWeight: FontWeight.w700))),
            ],
          );
        }),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF1F5F9),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF0F172A),
        elevation: 1,
        title: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.asset(
                'assets/logo-pia.png',
                width: 36,
                height: 36,
                fit: BoxFit.contain,
              ),
            ),
            const SizedBox(width: 10),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Pendidikan Islam At-Taqwa',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                  Text(
                    'Dashboard Monitoring & Rekapitulasi Presensi',
                    style: TextStyle(fontSize: 11, color: Color(0xFF64748B)),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          TextButton.icon(
            onPressed: _openPendaftaranDialog,
            icon: const Icon(Icons.person_add_alt_1, size: 18),
            label: const Text('Pendaftaran'),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          labelColor: const Color(0xFF2563EB),
          unselectedLabelColor: const Color(0xFF64748B),
          indicatorColor: const Color(0xFF2563EB),
          tabs: const [
            Tab(text: 'Data Siswa'),
            Tab(text: 'Data Guru'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // ==========================================
          // TAB 1: DATA SISWA
          // ==========================================
          ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                color: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Tabel Harian Presensi Siswa',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Sabtu otomatis libur. Ketuk tanggal di atas tabel untuk meliburkan hari.',
                        style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          DropdownButton<int>(
                            value: _siswaDailyMonth,
                            items: List.generate(12, (idx) {
                              return DropdownMenuItem(
                                value: idx,
                                child: Text(_monthNames[idx]),
                              );
                            }),
                            onChanged: (v) {
                              if (v != null) {
                                setState(() => _siswaDailyMonth = v);
                              }
                            },
                          ),
                          const SizedBox(width: 12),
                          DropdownButton<int>(
                            value: _siswaDailyYear,
                            items: _years.map((yr) {
                              return DropdownMenuItem(
                                value: yr,
                                child: Text('$yr'),
                              );
                            }).toList(),
                            onChanged: (v) {
                              if (v != null) {
                                setState(() => _siswaDailyYear = v);
                              }
                            },
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      _buildDailyMatrix(
                        people: _students,
                        year: _siswaDailyYear,
                        monthIndex: _siswaDailyMonth,
                        isTeacher: false,
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Card(
                color: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Rekap Absensi Siswa',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 8),
                      DropdownButton<String>(
                        value: _siswaRecapMode,
                        items: const [
                          DropdownMenuItem(
                            value: 'all',
                            child: Text('Semua Data (Awal s/d Akhir)'),
                          ),
                          DropdownMenuItem(
                            value: 'year',
                            child: Text('Pilih Tahun'),
                          ),
                          DropdownMenuItem(
                            value: 'month',
                            child: Text('Pilih Bulan & Tahun'),
                          ),
                        ],
                        onChanged: (v) {
                          if (v != null) {
                            setState(() => _siswaRecapMode = v);
                          }
                        },
                      ),
                      if (_siswaRecapMode != 'all')
                        Row(
                          children: [
                            if (_siswaRecapMode == 'month') ...[
                              DropdownButton<int>(
                                value: _siswaRecapMonth,
                                items: List.generate(12, (idx) {
                                  return DropdownMenuItem(
                                    value: idx,
                                    child: Text(_monthNames[idx]),
                                  );
                                }),
                                onChanged: (v) {
                                  if (v != null) {
                                    setState(() => _siswaRecapMonth = v);
                                  }
                                },
                              ),
                              const SizedBox(width: 12),
                            ],
                            DropdownButton<int>(
                              value: _siswaRecapYear,
                              items: _years.map((yr) {
                                return DropdownMenuItem(
                                  value: yr,
                                  child: Text('$yr'),
                                );
                              }).toList(),
                              onChanged: (v) {
                                if (v != null) {
                                  setState(() => _siswaRecapYear = v);
                                }
                              },
                            ),
                          ],
                        ),
                      const SizedBox(height: 8),
                      _buildRecapTable(
                        people: _students,
                        mode: _siswaRecapMode,
                        year: _siswaRecapYear,
                        monthIndex: _siswaRecapMonth,
                        isTeacher: false,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),

          // ==========================================
          // TAB 2: DATA GURU
          // ==========================================
          ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF1E3A8A), Color(0xFF2563EB)],
                  ),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Filter Periode Presensi Guru',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Mengatur Tabel Harian sekaligus Rekap Absensi Guru.',
                      style: TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        DropdownButton<int>(
                          dropdownColor: const Color(0xFF1E3A8A),
                          style: const TextStyle(color: Colors.white),
                          value: _guruMasterMonth,
                          items: List.generate(12, (idx) {
                            return DropdownMenuItem(
                              value: idx,
                              child: Text(_monthNames[idx]),
                            );
                          }),
                          onChanged: (v) {
                            if (v != null) {
                              setState(() => _guruMasterMonth = v);
                            }
                          },
                        ),
                        const SizedBox(width: 16),
                        DropdownButton<int>(
                          dropdownColor: const Color(0xFF1E3A8A),
                          style: const TextStyle(color: Colors.white),
                          value: _guruMasterYear,
                          items: _years.map((yr) {
                            return DropdownMenuItem(
                              value: yr,
                              child: Text('$yr'),
                            );
                          }).toList(),
                          onChanged: (v) {
                            if (v != null) {
                              setState(() => _guruMasterYear = v);
                            }
                          },
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Card(
                color: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Text(
                              'Tabel Harian Guru — ${_monthNames[_guruMasterMonth]} $_guruMasterYear',
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          OutlinedButton(
                            onPressed: _openManageTeachersVisibilityDialog,
                            child: const Text(
                              'Kelola Nama User',
                              style: TextStyle(fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      _buildDailyMatrix(
                        people: _visibleTeachers,
                        year: _guruMasterYear,
                        monthIndex: _guruMasterMonth,
                        isTeacher: true,
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Card(
                color: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Rekap Absensi Guru — ${_monthNames[_guruMasterMonth]} $_guruMasterYear',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 12),
                      _buildRecapTable(
                        people: _visibleTeachers,
                        mode: 'month',
                        year: _guruMasterYear,
                        monthIndex: _guruMasterMonth,
                        isTeacher: true,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
