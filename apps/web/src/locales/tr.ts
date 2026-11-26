import { commonTr } from '@mes/frontend/i18n'
import type { en } from './en'

export const tr: typeof en = {
  ...commonTr,
  nav: {
    main: 'Ana menü',
    home: 'EDMES başlangıç sayfası',
    collapse: 'Menüyü daralt',
    expand: 'Menüyü genişlet',
    system: 'Sistem',
    users: 'Kullanıcılar',
  },
  topbar: {
    plantTime: 'Tesis saati',
    userMenu: 'Kullanıcı menüsü',
    logOut: 'Oturumu kapat',
  },
  auth: {
    title: 'Oturum aç',
    email: 'E-posta',
    password: 'Parola',
    showPassword: 'Göster',
    hidePassword: 'Gizle',
    submit: 'Oturum aç',
    emailRequired: 'E-posta adresinizi girin.',
    passwordRequired: 'Parolanızı girin.',
    unreachable: 'Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.',
    timeout: 'Sunucu zamanında yanıt vermedi. Tekrar deneyin.',
    failed: 'Oturum açılamadı. Tekrar deneyin.',
    forgotPassword: 'Parolanızı mı unuttunuz? Parolaları bu tesisin bir yöneticisi sıfırlar.',
    tagline:
      'Üretimi planlayın ve izleyin, duruşların sebebini kayıt altında tutun ve size atanan iş merkezlerinin OEE değerlerini okuyun.',
    onPremise: 'Bu fabrikanın ağında çalışır · internet bağlantısı gerekmez',
  },
  access: {
    noAppTitle: 'Web uygulamasına erişim yok',
    noApp:
      'Hesabınızın web uygulamasına erişimi yok. Bir yönetici bu izni rollerinizden birine ekleyebilir.',
    noPageTitle: '{{page}} sayfasına erişiminiz yok',
    noPage:
      'Rolleriniz bu sayfayı açma iznini içermiyor. Bir yönetici bu izni rollerinizden birine ekleyebilir.',
  },
  home: {
    emptyTitle: 'Henüz gösterilecek bir şey yok',
    emptyMessage: 'Rolleriniz henüz web uygulamasında bir sayfa açmıyor.',
  },
  errors: {
    network: 'Sunucuya ulaşılamadı.',
    timeout: 'Sunucu zamanında yanıt vermedi.',
    unexpected: 'Bir şeyler ters gitti.',
  },
  table: {
    showing: '{{total}} kayıttan {{from}}–{{to}} gösteriliyor',
    rowsPerPage: 'Sayfa başına satır',
    previousPage: 'Önceki sayfa',
    nextPage: 'Sonraki sayfa',
    page: 'Sayfa {{page}}',
    pagination: 'Sayfalar',
  },
  users: {
    title: 'Kullanıcılar',
    table: 'Kullanıcılar',
    count_one: '{{count}} kullanıcı',
    count_other: '{{count}} kullanıcı',
    search: 'Kullanıcı ara',
    searchPlaceholder: 'Ad, kullanıcı adı veya e-posta ara',
    name: 'Ad',
    username: 'Kullanıcı adı',
    email: 'E-posta',
    workCenters: 'İş merkezleri',
    active: 'Etkin',
    isActive: 'Etkin',
    isInactive: 'Etkin değil',
    empty: 'Kullanıcı bulunamadı',
    emptyMessage: 'Bu aramaya uyan kullanıcı yok. Aramayı değiştirin ya da temizleyin.',
    loading: 'Kullanıcılar yükleniyor…',
    loadFailed: 'Kullanıcılar yüklenemedi',
  },
  notFound: {
    title: 'Sayfa bulunamadı',
    message: 'Bu adres web uygulamasının hiçbir sayfasıyla eşleşmiyor.',
  },
  version: {
    available: 'EDMES’in yeni bir sürümü hazır.',
    reload: 'Yeniden yükle',
  },
}
