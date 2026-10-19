'use client';
import { Toaster } from 'sonner';

// Toast standar app: posisi kanan atas, durasi 4 detik, varian success/error/info.
export function ToasterClient() {
  return <Toaster position="top-right" richColors closeButton toastOptions={{ duration: 4000 }} />;
}
