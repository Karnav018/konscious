import { Download } from '../../components/Download'
import { Features } from '../../components/Features'
import { Footer } from '../../components/Footer'
import { Header } from '../../components/Header'
import { Hero } from '../../components/Hero'

export function Landing() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Features />
        <Download />
      </main>
      <Footer />
    </>
  )
}
