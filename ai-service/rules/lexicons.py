"""
PSS06 - Symbolic knowledge: the word lists the rule engine reasons over.

This module is deliberately plain data. Everything the guideline layer knows
about "banned words", "generic affixes", "periodicity" and "the same word in
another language" is declared here, so a domain officer can extend the system
without touching any logic.
"""

# ---------------------------------------------------------------------------
# 3.a  Disallowed words - a title containing any of these is rejected outright.
# ---------------------------------------------------------------------------
DISALLOWED_WORDS = {
    # From the PRGI guideline
    "police", "crime", "corruption", "cbi", "cid", "army",
    # Enforcement / security bodies
    "criminal", "crimes", "cbi's", "raw", "ib", "narcotics", "ncb",
    "military", "navy", "airforce", "air-force", "paramilitary",
    "commando", "encounter", "bsf", "crpf", "nia", "ed", "vigilance",
    # Indian-language equivalents (Latin transliteration)
    "pulis", "police-wala", "apradh", "aparadh", "bhrashtachar",
    "bhrastachar", "sena", "fauj", "fauzi", "jasoos", "jasus",
    "atankwad", "atankvad", "gunda", "gundagardi", "mafia",
    # Devanagari / other scripts
    "पुलिस", "अपराध", "भ्रष्टाचार", "सीबीआई", "सीआईडी", "सेना", "फौज",
    "পুলিশ", "অপরাধ", "সেনা",
    "போலீஸ்", "குற்றம்",
    "పోలీసు", "నేరం",
    "ಪೊಲೀಸ್",
    "പോലീസ്",
    "પોલીસ", "ગુનો",
    "پولیس", "جرم", "فوج",
}

# Words that are sensitive but not automatically fatal - they downgrade the
# verification probability and force a human look.
FLAGGED_WORDS = {
    "government", "sarkar", "sarkari", "ministry", "mantralaya",
    "official", "rashtriya", "national", "bharat sarkar",
    "supreme court", "high court", "parliament", "sansad",
    "united nations", "un", "unesco", "unicef", "who",
}


# ---------------------------------------------------------------------------
# 1.b / 2.a  Generic prefixes and suffixes.
#
# These words carry almost no distinguishing power in the PRGI registry - a
# huge share of the 160,000 titles start or end with them. They are stripped
# before the "core" of a title is compared, and a new title that differs from
# an existing one *only* by one of these tokens is flagged.
# ---------------------------------------------------------------------------
GENERIC_PREFIXES = {
    "the", "a", "an", "shri", "sri", "shree", "new", "my", "our",
    "india", "indian", "bharat", "bharatiya", "hind", "hindustan",
    "hindustani", "national", "rashtriya", "all",
    "dainik", "daily", "sanjh", "prabhat", "aaj", "aj",
    "apna", "apni", "mera", "meri",
}
# Deliberately NOT generic: amar, jai, shubh, swarn, great, royal ... they are
# common but they still distinguish one masthead from another
# ("Amar Ujala" is not the same title as "Ujala").

GENERIC_SUFFIXES = {
    "news", "samachar", "samachaar", "sambad", "sambaad", "khabar",
    "khabren", "khabar", "times", "express", "post", "mail", "herald",
    "chronicle", "journal", "gazette", "bulletin", "tribune", "mirror",
    "voice", "vani", "vaani", "sandesh", "sandesa", "patrika", "patrica",
    "darpan", "darshan", "today", "live", "plus", "media", "network",
    "digest", "review", "report", "reporter", "observer", "star",
    "india", "bharat", "hind", "hindustan", "world", "online",
}

# Affixes that PRGI does not permit to be bolted onto an existing title in
# order to manufacture a "new" one.
DISALLOWED_AFFIXES = {
    "the", "india", "indian", "bharat", "national", "new", "my",
    "samachar", "news", "khabar", "sandesh", "times", "express",
    "live", "today", "plus", "online", "digital", "24x7", "24",
}


# ---------------------------------------------------------------------------
# 3.e  Periodicity words - adding one of these to an existing title does not
#      make the title new.
# ---------------------------------------------------------------------------
PERIODICITY_WORDS = {
    # English
    "daily", "weekly", "fortnightly", "biweekly", "bi-weekly", "monthly",
    "bimonthly", "bi-monthly", "quarterly", "halfyearly", "half-yearly",
    "annual", "annually", "yearly", "morning", "evening", "midday",
    "nightly", "hourly", "sunday", "monday", "saturday", "weekend",
    # Hindi / Marathi / Sanskrit-derived
    "dainik", "dainandin", "pratidin", "prathidin", "saptahik", "saptahika",
    "pakshik", "paakshik", "masik", "maasik", "traimasik", "vaarshik",
    "varshik", "ardhvarshik", "sanjh", "sandhya", "prabhat", "pratah",
    "ratri", "savera", "subah", "sham",
    # Bengali / Odia / Assamese
    "dainandin", "protidin", "pratidin", "saptahik", "masik",
    # Tamil / Telugu / Kannada / Malayalam
    "dina", "dinam", "dinamani", "vaara", "vaaram", "maasa", "maasika",
    "roz", "rozana", "hafta", "haftawar", "mahnama", "salana",
    # Devanagari
    "दैनिक", "साप्ताहिक", "मासिक", "पाक्षिक", "वार्षिक", "प्रतिदिन",
    "संध्या", "प्रभात",
}


# ---------------------------------------------------------------------------
# 3.d  Cross-language meaning map.
#
# BGE-M3 already places "Daily Evening" and "Pratidin Sandhya" near each other
# in vector space, but a neural score alone is not defensible in a rejection
# letter. This dictionary gives the symbolic layer a citable reason:
# "'pratidin' is a known synonym of 'daily'".
#
# Every key maps to a canonical English concept.
# ---------------------------------------------------------------------------
CONCEPT_LEXICON = {
    # daily
    "daily": "daily", "dainik": "daily", "pratidin": "daily",
    "protidin": "daily", "prathidin": "daily", "roz": "daily",
    "rozana": "daily", "dina": "daily", "dinam": "daily",
    "dinapatrike": "daily", "nithya": "daily", "दैनिक": "daily",
    "प्रतिदिन": "daily",
    # weekly
    "weekly": "weekly", "saptahik": "weekly", "saptahika": "weekly",
    "haftawar": "weekly", "vaara": "weekly", "vaaram": "weekly",
    "साप्ताहिक": "weekly",
    # monthly
    "monthly": "monthly", "masik": "monthly", "maasik": "monthly",
    "mahnama": "monthly", "maasika": "monthly", "मासिक": "monthly",
    # evening
    "evening": "evening", "sandhya": "evening", "sanjh": "evening",
    "sham": "evening", "shaam": "evening", "sanjha": "evening",
    "maalai": "evening", "संध्या": "evening",
    # morning
    "morning": "morning", "prabhat": "morning", "pratah": "morning",
    "savera": "morning", "subah": "morning", "kaalai": "morning",
    "usha": "morning", "प्रभात": "morning",
    # news
    "news": "news", "samachar": "news", "samachaar": "news",
    "sambad": "news", "sambaad": "news", "khabar": "news",
    "khabren": "news", "khabrein": "news", "varta": "news",
    "varthe": "news", "vartha": "news", "seithi": "news",
    "seidhi": "news", "vaartha": "news", "समाचार": "news",
    "खबर": "news",
    # voice
    "voice": "voice", "vani": "voice", "vaani": "voice", "awaz": "voice",
    "awaaz": "voice", "swar": "voice", "dhwani": "voice", "आवाज": "voice",
    # light / lamp
    "light": "light", "prakash": "light", "jyoti": "light",
    "ujala": "light", "roshni": "light", "deep": "light",
    "deepak": "light", "diya": "light", "प्रकाश": "light",
    # message / mail
    "message": "message", "sandesh": "message", "sandesa": "message",
    "sandes": "message", "paigam": "message", "paigham": "message",
    "संदेश": "message",
    # mirror
    "mirror": "mirror", "darpan": "mirror", "aaina": "mirror",
    "aina": "mirror", "kannadi": "mirror",
    # times / age
    "times": "times", "samay": "times", "kaal": "times", "yug": "times",
    "zamana": "times", "vakt": "times",
    # country / nation
    "india": "india", "bharat": "india", "hind": "india",
    "hindustan": "india", "bharatvarsh": "india", "भारत": "india",
    "nation": "nation", "rashtra": "nation", "desh": "nation",
    "deshi": "nation", "watan": "nation", "vatan": "nation",
    # people / public
    "people": "people", "jan": "people", "jana": "people",
    "lok": "people", "loka": "people", "awam": "people",
    "praja": "people", "janata": "people",
    # sun / dawn
    "sun": "sun", "surya": "sun", "suraj": "sun", "bhaskar": "sun",
    "aftab": "sun", "ravi": "sun", "dinkar": "sun",
    # earth / world
    "world": "world", "jagat": "world", "vishwa": "world",
    "duniya": "world", "sansar": "world", "jag": "world",
    # today
    "today": "today", "aaj": "today", "aj": "today", "ajker": "today",
    "indru": "today", "iravu": "today",
    # star
    "star": "star", "tara": "star", "sitara": "star", "nakshatra": "star",
    # flame / fire
    "fire": "fire", "agni": "fire", "aag": "fire", "jwala": "fire",
    # truth
    "truth": "truth", "satya": "truth", "sach": "truth", "sacch": "truth",
    "haqiqat": "truth",
    # new
    "new": "new", "naya": "new", "nav": "new", "nava": "new",
    "naveen": "new", "nutan": "new", "hosa": "new", "puthiya": "new",
    # front / forward
    "front": "front", "morcha": "front", "agrani": "front",
    # power / strength
    "power": "power", "shakti": "power", "sakthi": "power",
    "bal": "power", "taqat": "power", "urja": "power",
    # freedom
    "freedom": "freedom", "azadi": "freedom", "swatantra": "freedom",
    "mukti": "freedom",
    # guardian / protector
    "guardian": "guardian", "rakshak": "guardian", "prahari": "guardian",
    "sentinel": "guardian", "chowkidar": "guardian",
    # salute / greeting
    "greeting": "greeting", "namaskar": "greeting", "namaste": "greeting",
    "salam": "greeting", "vandana": "greeting", "abhinandan": "greeting",
}


# ---------------------------------------------------------------------------
# 1.c  Known transliteration equivalences that pure edit distance handles
#      badly. "Namaskar" vs "Namascar" is caught by phonetics; the pairs below
#      are the ones phonetics also gets wrong.
# ---------------------------------------------------------------------------
TRANSLITERATION_VARIANTS = [
    ("ck", "k"), ("kh", "k"), ("gh", "g"), ("ph", "f"), ("bh", "b"),
    ("dh", "d"), ("th", "t"), ("ch", "c"), ("sh", "s"), ("zh", "j"),
    ("aa", "a"), ("ee", "i"), ("ii", "i"), ("oo", "u"), ("uu", "u"),
    ("ay", "e"), ("ai", "e"), ("au", "o"), ("ou", "o"), ("ey", "e"),
    ("w", "v"), ("z", "j"), ("q", "k"), ("x", "ks"), ("y", "i"),
]


# ---------------------------------------------------------------------------
# Stop words removed before core-token comparison.
# ---------------------------------------------------------------------------
STOP_WORDS = {
    "of", "and", "the", "a", "an", "in", "on", "for", "to", "at",
    "by", "with", "from", "ka", "ke", "ki", "aur", "se", "me", "mein",
    "&", "-", "ltd", "pvt", "limited", "publications", "publication",
}


def concept_of(token: str) -> str:
    """Map a token to its canonical cross-language concept (or itself)."""
    return CONCEPT_LEXICON.get(token.lower(), token.lower())
