-- Сеть: страница /profile/web/[nick]

CREATE TABLE "NetProfile" (
    "userId" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "status" TEXT,
    "bgId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NetProfile_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "NetTheme" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NetTheme_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NetThemeComment" (
    "id" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NetThemeComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NetThemeVote" (
    "id" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    CONSTRAINT "NetThemeVote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NetPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "gifUrl" TEXT,
    "videoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NetPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NetPostVote" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "NetPostVote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NetComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NetComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NetFollow" (
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NetFollow_pkey" PRIMARY KEY ("followerId","followingId")
);

CREATE TABLE "NetNews" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NetNews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NetThemeVote_themeId_userId_key" ON "NetThemeVote"("themeId", "userId");
CREATE UNIQUE INDEX "NetPostVote_postId_userId_key" ON "NetPostVote"("postId", "userId");
CREATE INDEX "NetTheme_userId_createdAt_idx" ON "NetTheme"("userId", "createdAt");
CREATE INDEX "NetTheme_createdAt_idx" ON "NetTheme"("createdAt");
CREATE INDEX "NetThemeComment_themeId_createdAt_idx" ON "NetThemeComment"("themeId", "createdAt");
CREATE INDEX "NetThemeVote_userId_idx" ON "NetThemeVote"("userId");
CREATE INDEX "NetPost_userId_createdAt_idx" ON "NetPost"("userId", "createdAt");
CREATE INDEX "NetComment_postId_createdAt_idx" ON "NetComment"("postId", "createdAt");
CREATE INDEX "NetFollow_followingId_idx" ON "NetFollow"("followingId");
CREATE INDEX "NetNews_createdAt_idx" ON "NetNews"("createdAt");

ALTER TABLE "NetProfile" ADD CONSTRAINT "NetProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetTheme" ADD CONSTRAINT "NetTheme_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetThemeComment" ADD CONSTRAINT "NetThemeComment_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "NetTheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetThemeComment" ADD CONSTRAINT "NetThemeComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetThemeVote" ADD CONSTRAINT "NetThemeVote_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "NetTheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetThemeVote" ADD CONSTRAINT "NetThemeVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetPost" ADD CONSTRAINT "NetPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetPostVote" ADD CONSTRAINT "NetPostVote_postId_fkey" FOREIGN KEY ("postId") REFERENCES "NetPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetPostVote" ADD CONSTRAINT "NetPostVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetComment" ADD CONSTRAINT "NetComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "NetPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetComment" ADD CONSTRAINT "NetComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetFollow" ADD CONSTRAINT "NetFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetFollow" ADD CONSTRAINT "NetFollow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetNews" ADD CONSTRAINT "NetNews_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
