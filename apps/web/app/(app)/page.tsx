import { redirect } from 'next/navigation';

// Root localhost membuka halaman login sebagai halaman awal utama.
export default function RootPage() {
  redirect('/login');
}
