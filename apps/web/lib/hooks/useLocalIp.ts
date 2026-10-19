'use client';

import { useEffect, useState } from 'react';

/**
 * Deteksi alamat IPv4 lokal komputer lewat WebRTC.
 *
 * KENAPA
 * Server hanya melihat `::1` bila aplikasi diakses dari komputer yang sama
 * (atau alamat reverse proxy bila di belakang Caddy). Untuk menampilkan IP
 * komputer pengguna yang sebenarnya, peramban bisa melaporkan kandidat
 * ICE-nya sendiri.
 *
 * CATATAN KEAMANAN
 * Ini memakai `RTCPeerConnection` dengan kandidat mDNS. Peramban modern
 * menyamarkan IP lokal sebagai `xxx.local`, sehingga hasilnya TIDAK selalu
 * berupa IP. Bila tidak ada IPv4 privat yang terdeteksi, fungsi
 * mengembalikan null dan UI jatuh kembali ke IP yang dilihat server.
 *
 * Tidak ada koneksi keluar: peer connection dibuat lalu langsung ditutup,
 * tanpa STUN/TURN, tanpa mengirim data ke pihak ketiga.
 */

const IPV4 = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;

function extractIp(candidate: string): string | null {
  const m = IPV4.exec(candidate);
  if (!m) return null;
  const ip = m[1];
  const parts = ip.split('.').map(Number);
  if (parts.some((p) => p > 255)) return null;
  if (ip === '0.0.0.0') return null;
  return ip;
}

export function useLocalIp(enabled = true): string | null {
  const [ip, setIp] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    const RTC =
      window.RTCPeerConnection ??
      (window as unknown as { webkitRTCPeerConnection?: typeof RTCPeerConnection }).webkitRTCPeerConnection;
    if (!RTC) return;

    let pc: RTCPeerConnection | null = null;
    let cancelled = false;

    try {
      pc = new RTC({ iceServers: [] });
      pc.createDataChannel('probe');

      pc.onicecandidate = (event) => {
        if (cancelled || !event.candidate) return;
        const found = extractIp(event.candidate.candidate);
        if (found && !found.startsWith('127.')) {
          setIp(found);
          cancelled = true;
          pc?.close();
          pc = null;
        }
      };

      pc.createOffer()
        .then((offer) => pc?.setLocalDescription(offer))
        .catch(() => undefined);

      // Batas waktu: jangan menahan UI menunggu kandidat yang tidak datang.
      const timer = setTimeout(() => {
        if (!cancelled) {
          cancelled = true;
          pc?.close();
          pc = null;
        }
      }, 1500);

      return () => {
        cancelled = true;
        clearTimeout(timer);
        pc?.close();
      };
    } catch {
      // Peramban memblokir WebRTC: biarkan null.
    }
    return () => {
      cancelled = true;
      pc?.close();
    };
  }, [enabled]);

  return ip;
}
