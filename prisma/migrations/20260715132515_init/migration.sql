-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('IP', 'CIDR', 'RANGE');

-- CreateTable
CREATE TABLE "Feed" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "token" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpEntry" (
    "id" UUID NOT NULL,
    "feedId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "kind" "EntryKind" NOT NULL,
    "family" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Feed_slug_key" ON "Feed"("slug");

-- CreateIndex
CREATE INDEX "Feed_enabled_idx" ON "Feed"("enabled");

-- CreateIndex
CREATE INDEX "IpEntry_feedId_idx" ON "IpEntry"("feedId");

-- CreateIndex
CREATE INDEX "IpEntry_feedId_enabled_idx" ON "IpEntry"("feedId", "enabled");

-- CreateIndex
CREATE INDEX "IpEntry_family_idx" ON "IpEntry"("family");

-- CreateIndex
CREATE INDEX "IpEntry_feedId_family_value_idx" ON "IpEntry"("feedId", "family", "value");

-- CreateIndex
CREATE UNIQUE INDEX "IpEntry_feedId_value_key" ON "IpEntry"("feedId", "value");

-- AddForeignKey
ALTER TABLE "IpEntry" ADD CONSTRAINT "IpEntry_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
