// 홈 화면 설치(앱처럼 실행)를 위한 최소 서비스 워커: 캐시 없이 항상 네트워크를 그대로 사용한다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
