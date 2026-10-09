// Per-language knobs for the agent.
//
// countries   -> tried against filter.release_country for films & shows.
//                Names first, ISO codes as a fallback; the agent remembers which works.
// music/books/podcasts -> words we feed to Qloo's tag search to find the right tag IDs.
// cuisine     -> used to find somewhere near you to practise ordering.
// usual       -> what every generic "learn X with media" listicle says. We show it
//                next to your plan so the difference is obvious.

export const LANGUAGES = {
  ja: {
    name: 'Japanese', hello: 'Konnichiwa',
    countries: [['Japan'], ['JP']],
    music: ['j-pop', 'j-rock', 'city pop', 'japanese'],
    books: ['japanese literature', 'japanese fiction', 'manga'],
    podcasts: ['japanese language', 'learn japanese', 'japanese'],
    cuisine: ['japanese', 'ramen', 'sushi'],
    usual: ['Spirited Away', 'Your Name', 'Terrace House', 'Norwegian Wood'],
  },
  ko: {
    name: 'Korean', hello: 'Annyeonghaseyo',
    countries: [['South Korea', 'Korea, Republic of'], ['KR']],
    music: ['k-pop', 'korean', 'k-indie', 'korean hip hop'],
    books: ['korean literature', 'korean fiction', 'manhwa'],
    podcasts: ['korean language', 'learn korean', 'korean'],
    cuisine: ['korean', 'korean bbq'],
    usual: ['Parasite', 'Squid Game', 'Crash Landing on You', 'BTS'],
  },
  es: {
    name: 'Spanish', hello: '¡Hola!',
    countries: [['Spain', 'Mexico', 'Argentina', 'Colombia', 'Chile'], ['ES', 'MX', 'AR', 'CO', 'CL']],
    music: ['latin', 'latin pop', 'reggaeton', 'rock en español', 'spanish'],
    books: ['latin american literature', 'spanish literature', 'magical realism'],
    podcasts: ['spanish language', 'learn spanish', 'spanish'],
    cuisine: ['mexican', 'spanish', 'tapas'],
    usual: ['Money Heist', 'Narcos', 'Coco', 'One Hundred Years of Solitude'],
  },
  fr: {
    name: 'French', hello: 'Bonjour',
    countries: [['France', 'Belgium', 'Canada'], ['FR', 'BE']],
    music: ['french pop', 'chanson', 'french hip hop', 'french'],
    books: ['french literature', 'french fiction'],
    podcasts: ['french language', 'learn french', 'french'],
    cuisine: ['french', 'bakery', 'bistro'],
    usual: ['Amélie', 'Lupin', 'Emily in Paris', 'The Little Prince'],
  },
  de: {
    name: 'German', hello: 'Hallo',
    countries: [['Germany', 'Austria', 'Switzerland'], ['DE', 'AT', 'CH']],
    music: ['german', 'deutschrap', 'krautrock', 'german pop'],
    books: ['german literature', 'german fiction'],
    podcasts: ['german language', 'learn german', 'german'],
    cuisine: ['german', 'beer garden'],
    usual: ['Dark', 'Good Bye Lenin!', 'Run Lola Run', 'Rammstein'],
  },
  hi: {
    name: 'Hindi', hello: 'Namaste',
    countries: [['India'], ['IN']],
    music: ['bollywood', 'filmi', 'hindi', 'indian pop'],
    books: ['indian literature', 'hindi', 'indian fiction'],
    podcasts: ['hindi', 'learn hindi', 'indian'],
    cuisine: ['indian', 'north indian'],
    usual: ['3 Idiots', 'Dilwale Dulhania Le Jayenge', 'Sacred Games', 'Arijit Singh'],
  },
  pt: {
    name: 'Portuguese', hello: 'Olá',
    countries: [['Brazil', 'Portugal'], ['BR', 'PT']],
    music: ['mpb', 'bossa nova', 'brazilian', 'samba', 'sertanejo'],
    books: ['brazilian literature', 'portuguese literature'],
    podcasts: ['portuguese language', 'learn portuguese', 'brazilian'],
    cuisine: ['brazilian', 'portuguese'],
    usual: ['City of God', 'Central Station', '3%', 'The Alchemist'],
  },
  it: {
    name: 'Italian', hello: 'Ciao',
    countries: [['Italy'], ['IT']],
    music: ['italian pop', 'italian', 'cantautori', 'italo disco'],
    books: ['italian literature', 'italian fiction'],
    podcasts: ['italian language', 'learn italian', 'italian'],
    cuisine: ['italian', 'pizza', 'trattoria'],
    usual: ['Life Is Beautiful', 'Cinema Paradiso', 'My Brilliant Friend', 'Måneskin'],
  },
  zh: {
    name: 'Mandarin', hello: 'Nǐ hǎo',
    countries: [['China', 'Taiwan', 'Hong Kong'], ['CN', 'TW', 'HK']],
    music: ['mandopop', 'c-pop', 'chinese', 'taiwanese'],
    books: ['chinese literature', 'chinese fiction', 'wuxia'],
    podcasts: ['chinese language', 'learn mandarin', 'mandarin'],
    cuisine: ['chinese', 'dim sum', 'sichuan'],
    usual: ['Crouching Tiger, Hidden Dragon', 'In the Mood for Love', 'The Wandering Earth', 'Jay Chou'],
  },
};

// How each level changes what we ask Qloo for.
// Popular titles are easier to start with: they have subtitles, wikis, fan translations.
export const LEVELS = {
  beginner: { label: 'Just starting', popMin: 0.55, take: 4, order: ['artist', 'movie', 'tv_show', 'place'] },
  intermediate: { label: 'I can follow along with subtitles', popMin: 0.3, take: 4, order: ['tv_show', 'artist', 'podcast', 'movie'] },
  advanced: { label: 'I want the deep cuts', popMin: 0, take: 5, order: ['book', 'podcast', 'movie', 'tv_show'] },
};
