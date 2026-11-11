'use strict';

/**
 * Validasi identifier SQL (nama tabel dan kolom).
 *
 * Nama tabel/kolom tidak bisa diparameterkan, jadi harus disisipkan ke
 * SQL apa adanya. Pola di sini menerima **hanya** nama sederhana:
 * huruf/underscore di awal, lalu huruf/angka/underscore.
 *
 * Modul ini ada supaya query builder dan soft delete memakai aturan yang
 * sama persis — dua implementasi terpisah bisa berbeda diam-diam.
 */

/** Pola nama identifier SQL yang aman. */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Pastikan `name` adalah identifier SQL yang valid.
 *
 * Melempar `Error` (bukan BonangError) supaya perilaku-nya sama dengan
 * pemanggilan di query builder — pemanggil telah menangkap keduanya.
 */
function assertIdentifier(name, label = 'identifier') {
    if (typeof name !== 'string' || !IDENTIFIER_PATTERN.test(name)) {
        throw new Error(`Nama ${label} tidak valid: '${name}'`);
    }
    return name;
}

module.exports = {
    IDENTIFIER_PATTERN,
    assertIdentifier
};
