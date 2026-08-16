export const languages = { en: 'English', ko: '한국어' } as const;
export const defaultLang = 'en' as const;
export type Lang = keyof typeof languages;

export const ui = {
  en: {
    'nav.home': 'Home',
    'nav.news': 'News',
    'nav.leaderboards': 'Leaderboards',
    'nav.games': 'Games',
    'nav.updates': 'Game Updates',
    'nav.clips': 'Viral Clips',
    'nav.deals': 'Free & Deals',
    'nav.tools': 'Tools',
    'nav.about': 'About',
    'nav.menu': 'Menu',
    'nav.close': 'Close menu',

    'theme.toggle': 'Toggle dark mode',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'lang.switch': 'Read in Korean',

    'live.updated': 'Updated',
    'live.refreshing': 'Refreshing…',
    'live.auto': 'Auto-refreshes every 90 seconds',
    'live.stale': 'Data may be stale — last refresh failed',
    'live.never': 'No data yet',

    'lb.title': 'Live Player Count Leaderboard',
    'lb.sub': 'The most-played games on Steam right now, ranked by concurrent players. Rebuilt every 30 minutes from Valve’s public API.',
    'lb.rank': 'Rank',
    'lb.game': 'Game',
    'lb.players': 'Playing now',
    'lb.peak': 'Peak today',
    'lb.change': '24h',
    'lb.trend': 'Trend',
    'lb.movers': 'Biggest movers',
    'lb.risers': 'Climbing',
    'lb.fallers': 'Falling',
    'lb.total': 'Total players across top 100',
    'lb.note': 'Player counts are Steam concurrents only — no console platform holder publishes a comparable live figure, so console players are absent. The mobile section ranks by App Store rating volume, which is a popularity proxy and not a player count.',

    'up.title': 'Game Update Tracker',
    'up.sub': 'Patch notes and season launches for the biggest live-service games, pulled straight from official sources.',
    'up.latest': 'Latest patch',
    'up.readNotes': 'Read official notes',
    'up.version': 'Version',
    'up.noData': 'No updates fetched yet.',

    'clip.title': 'Trending Highlight Clips',
    'clip.sub': 'Gaming videos gaining views fastest right now, ranked by view velocity rather than raw totals.',
    'clip.velocity': 'views/hr',
    'clip.views': 'views',
    'clip.watch': 'Watch on YouTube',
    'clip.ago': 'ago',

    'deal.title': 'Free Games & Deals',
    'deal.sub': 'Currently free giveaways and the steepest discounts across stores.',
    'deal.free': 'Free now',
    'deal.upcoming': 'Free soon',
    'deal.claim': 'Claim',
    'deal.was': 'was',
    'deal.off': 'off',
    'deal.ends': 'Ends',
    'deal.starts': 'Starts',

    'tools.title': 'Gamer Tools',
    'tools.sub': 'Small utilities worth bookmarking.',

    'post.readMore': 'Read more',
    'post.min': 'min read',
    'post.published': 'Published',
    'post.updated': 'Updated',
    'post.by': 'By',
    'post.sources': 'Sources & further reading',
    'post.related': 'Related reading',
    'post.toc': 'On this page',
    'post.share': 'Share',
    'post.takeaway': 'The short version',
    'post.faq': 'Frequently asked questions',
    'post.factChecked': 'Fact-checked against primary sources',
    'post.aiAssisted': 'AI-assisted draft, human-reviewed',
    'post.aiUnreviewed': 'Written by AI from corroborated sources — not yet reviewed by a person',
    'post.tags': 'Tags',
    'post.backTo': 'All articles',

    'home.latest': 'Latest coverage',
    'home.featured': 'Featured',
    'home.liveNow': 'Live right now',
    'home.viewAll': 'View all',
    'home.trending': 'Trending clips',
    'home.freeNow': 'Free to claim',
    'home.recentPatches': 'Recent patches',

    'footer.rights': 'All rights reserved.',
    'footer.disclaimer': 'Game titles, artwork and trademarks are the property of their respective publishers. GamePulse is an independent publication and is not affiliated with any game publisher or platform holder.',
    'footer.data': 'Data sources',
    'footer.legal': 'Legal',
    'footer.sections': 'Sections',

    'consent.text': 'We use cookies for analytics and, where enabled, personalised advertising.',
    'consent.accept': 'Accept all',
    'consent.reject': 'Reject non-essential',
    'consent.manage': 'Learn more',

    'search.placeholder': 'Search articles…',
    'search.noResults': 'No articles matched that search.',

    '404.title': 'Page not found',
    '404.body': 'That link is broken or the page has moved.',
    '404.home': 'Back to the homepage',
  },
  ko: {
    'nav.home': '홈',
    'nav.news': '뉴스',
    'nav.leaderboards': '실시간 순위',
    'nav.games': '게임',
    'nav.updates': '게임 업데이트',
    'nav.clips': '화제의 영상',
    'nav.deals': '무료·할인',
    'nav.tools': '도구',
    'nav.about': '소개',
    'nav.menu': '메뉴',
    'nav.close': '메뉴 닫기',

    'theme.toggle': '다크 모드 전환',
    'theme.light': '라이트',
    'theme.dark': '다크',
    'lang.switch': '영어로 보기',

    'live.updated': '갱신',
    'live.refreshing': '갱신 중…',
    'live.auto': '90초마다 자동 갱신',
    'live.stale': '갱신에 실패해 데이터가 오래되었을 수 있습니다',
    'live.never': '데이터 없음',

    'lb.title': '실시간 동시접속자 순위',
    'lb.sub': '지금 스팀에서 가장 많이 플레이되는 게임 순위입니다. 밸브 공개 API를 30분마다 반영합니다.',
    'lb.rank': '순위',
    'lb.game': '게임',
    'lb.players': '현재 접속',
    'lb.peak': '오늘 최고',
    'lb.change': '24시간',
    'lb.trend': '추이',
    'lb.movers': '순위 변동',
    'lb.risers': '상승',
    'lb.fallers': '하락',
    'lb.total': '상위 100개 게임 총 접속자',
    'lb.note': '접속자 수는 스팀 동시접속자 기준입니다. 콘솔은 플랫폼사가 동등한 실시간 수치를 공개하지 않아 포함되지 않습니다. 모바일 항목은 앱스토어 누적 평점 개수를 기준으로 한 인기도 지표이며 접속자 수가 아닙니다.',

    'up.title': '게임 업데이트 트래커',
    'up.sub': '주요 라이브 서비스 게임의 패치노트와 시즌 소식을 공식 출처에서 바로 가져옵니다.',
    'up.latest': '최신 패치',
    'up.readNotes': '공식 패치노트 보기',
    'up.version': '버전',
    'up.noData': '아직 수집된 업데이트가 없습니다.',

    'clip.title': '급상승 하이라이트 영상',
    'clip.sub': '누적 조회수가 아니라 시간당 조회수 증가 속도로 정렬한, 지금 가장 빠르게 퍼지는 게임 영상입니다.',
    'clip.velocity': '조회/시간',
    'clip.views': '조회',
    'clip.watch': '유튜브에서 보기',
    'clip.ago': '전',

    'deal.title': '무료 게임 & 할인',
    'deal.sub': '지금 무료로 받을 수 있는 게임과 스토어별 최대 할인입니다.',
    'deal.free': '지금 무료',
    'deal.upcoming': '곧 무료',
    'deal.claim': '받기',
    'deal.was': '정가',
    'deal.off': '할인',
    'deal.ends': '종료',
    'deal.starts': '시작',

    'tools.title': '게이머 도구',
    'tools.sub': '즐겨찾기 해둘 만한 작은 유틸리티 모음입니다.',

    'post.readMore': '더 읽기',
    'post.min': '분 소요',
    'post.published': '작성',
    'post.updated': '수정',
    'post.by': '글',
    'post.sources': '출처 및 더 읽을거리',
    'post.related': '관련 기사',
    'post.toc': '목차',
    'post.share': '공유',
    'post.takeaway': '핵심 요약',
    'post.faq': '자주 묻는 질문',
    'post.factChecked': '1차 출처로 사실 확인을 마쳤습니다',
    'post.aiAssisted': 'AI 초안 작성 후 사람이 검수했습니다',
    'post.aiUnreviewed': '교차 검증된 출처를 바탕으로 AI가 작성했으며, 아직 사람의 검수를 거치지 않았습니다',
    'post.tags': '태그',
    'post.backTo': '전체 기사',

    'home.latest': '최신 기사',
    'home.featured': '주요 기사',
    'home.liveNow': '지금 실시간',
    'home.viewAll': '전체 보기',
    'home.trending': '화제의 영상',
    'home.freeNow': '지금 무료',
    'home.recentPatches': '최근 패치',

    'footer.rights': '모든 권리 보유.',
    'footer.disclaimer': '게임 제목, 이미지, 상표의 권리는 각 퍼블리셔에 있습니다. GamePulse는 독립 매체이며 어떤 게임사나 플랫폼사와도 제휴 관계가 없습니다.',
    'footer.data': '데이터 출처',
    'footer.legal': '약관',
    'footer.sections': '섹션',

    'consent.text': '분석 및 (활성화된 경우) 맞춤 광고를 위해 쿠키를 사용합니다.',
    'consent.accept': '모두 동의',
    'consent.reject': '필수만 허용',
    'consent.manage': '자세히',

    'search.placeholder': '기사 검색…',
    'search.noResults': '검색 결과가 없습니다.',

    '404.title': '페이지를 찾을 수 없습니다',
    '404.body': '링크가 잘못되었거나 페이지가 이동했습니다.',
    '404.home': '홈으로 돌아가기',
  },
} as const;

export function useTranslations(lang: Lang) {
  return function t(key: keyof (typeof ui)['en']): string {
    return (ui[lang] as Record<string, string>)[key] ?? ui[defaultLang][key];
  };
}

export function getLangFromUrl(url: URL): Lang {
  const [, maybeBase, maybeLang] = url.pathname.split('/');
  if (maybeBase === 'ko' || maybeLang === 'ko') return 'ko';
  return 'en';
}
