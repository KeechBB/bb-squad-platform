export type NetPerson = { nick: string; avatarUrl: string | null };

export type NetThemeCard = {
  id: string;
  title: string;
  body: string;
  imageUrls: string[];
  authorNick: string;
  likes: number;
  dislikes: number;
  myVote: -1 | 0 | 1;
  mine: boolean;
  createdAt: string;
  comments: NetCommentCard[];
};

export type NetCommentCard = {
  id: string;
  nick: string;
  body: string;
  createdAt: string;
};

export type NetPostCard = {
  id: string;
  body: string;
  imageUrl: string | null;
  gifUrl: string | null;
  videoUrl: string | null;
  likes: number;
  dislikes: number;
  myVote: -1 | 0 | 1;
  createdAt: string;
  comments: NetCommentCard[];
};

export type NetNewsCard = {
  id: string;
  title: string;
  body: string;
  authorNick: string;
  createdAt: string;
};

export type NetBgChoice = { id: string; file: string; label: string };

export type NetChatLine = {
  id: string;
  nick: string;
  body: string;
  createdAt: string;
};

export type NetPageData = {
  nick: string;
  isOwn: boolean;
  canNews: boolean;
  avatarUrl: string | null;
  status: string;
  bgUrl: string | null;
  bgId: string | null;
  bgChoices: NetBgChoice[];
  subscribed: boolean;
  followers: NetPerson[];
  following: NetPerson[];
  themes: NetThemeCard[];
  themeLimit: number;
  popular: NetThemeCard[];
  posts: NetPostCard[];
  news: NetNewsCard[];
  online: NetPerson[];
};
