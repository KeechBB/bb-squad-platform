import Image from "next/image";
import Link from "next/link";

const YEAR = new Date().getFullYear();

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <Image
            src="/brand/blackberry.png"
            alt=""
            width={48}
            height={48}
            className="site-footer-logo"
          />
          <div className="site-footer-brand-text">
            <p className="site-footer-name">BLACKBERRY</p>
            <p className="site-footer-tag">
              Официальный портал сообщества · Squad
            </p>
          </div>
        </div>

        <nav className="site-footer-nav" aria-label="Подвал">
          <Link href="/">Главная</Link>
          <Link href="/public">Рейтинг паблика</Link>
          <Link href="/battle-pass">Battle Pass</Link>
          <Link href="/clans">Кланы</Link>
        </nav>

        <div className="site-footer-meta">
          <p className="site-footer-copy">
            © 2023–{YEAR} BlackBerry Squad · bb-squad.ru
          </p>
          <p className="site-footer-note">
            На сайте используется Яндекс&nbsp;Метрика для статистики посещений.
          </p>
        </div>
      </div>
    </footer>
  );
}
