import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-base flex flex-col items-center justify-center text-center px-4">
      <p className="text-8xl font-bold text-brand">404</p>
      <p className="mt-4 text-xl text-[#e5e5e5]/60">Page not found</p>
      <Link
        to="/"
        className="mt-8 px-6 py-2.5 bg-brand text-black font-semibold rounded-lg hover:bg-brand-hover transition-colors"
      >
        Go home
      </Link>
    </div>
  )
}
