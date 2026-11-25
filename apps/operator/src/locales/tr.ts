import { commonTr } from '@mes/frontend/i18n'
import type { en } from './en'

export const tr: typeof en = {
  ...commonTr,
  auth: {
    title: 'Operatör paneli',
    email: 'E-posta',
    password: 'Parola',
    submit: 'Oturum aç',
    unreachable: 'Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.',
    timeout: 'Sunucu zamanında yanıt vermedi. Tekrar deneyin.',
    failed: 'Oturum açılamadı. Tekrar deneyin.',
  },
  access: {
    noPanelTitle: 'Operatör paneline erişim yok',
    noPanel:
      'Hesabınızın operatör paneline erişimi yok. Bir yönetici bu izni rollerinizden birine ekleyebilir.',
  },
  picker: {
    title: 'Bu istasyonun iş merkezini seçin',
    none: 'Size atanmış bir iş merkezi yok',
    noneMessage: 'Bir yönetici size bir iş merkezi atayabilir.',
    loadFailed: 'İş merkezleri yüklenemedi',
  },
  station: {
    jobOrder: 'İş emri',
    running: 'Çalışıyor',
    target: 'Hedef',
    noRunningJobOrder: 'Çalışan iş emri yok',
    jobOrderFailed: 'İş emri yüklenemedi',
    workCenterFailed: 'İş merkezi yüklenemedi',
  },
  notFound: {
    title: 'Sayfa bulunamadı',
    back: 'İstasyona dön',
  },
}
