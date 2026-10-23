#!/bin/sh
# Builds / updates a signed apt repository.
#   make-apt-repo.sh <dir with .deb files> <repo dir> <gpg key id>
# The repo dir may already hold older versions (pool/main keeps them).
# Needs apt-ftparchive (package apt-utils) and the gpg key in the current keyring.
set -e
DEBS=$1; REPO=$2; KEY=$3; SUITE=stable
[ -n "$KEY" ] || { echo "usage: $0 <debs> <repo> <gpg key id>" >&2; exit 2; }
mkdir -p "$REPO/pool/main"
cp "$DEBS"/*.deb "$REPO/pool/main/"
cd "$REPO"
for A in amd64 arm64; do
  mkdir -p "dists/$SUITE/main/binary-$A"
  apt-ftparchive --arch "$A" packages pool/main > "dists/$SUITE/main/binary-$A/Packages"
  gzip -kf "dists/$SUITE/main/binary-$A/Packages"
done
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=ZebraApp -o APT::FTPArchive::Release::Label=ZebraApp \
  -o APT::FTPArchive::Release::Suite=$SUITE -o APT::FTPArchive::Release::Codename=$SUITE \
  -o APT::FTPArchive::Release::Architectures="amd64 arm64" -o APT::FTPArchive::Release::Components=main \
  release "dists/$SUITE" > "dists/$SUITE/Release.new"
mv "dists/$SUITE/Release.new" "dists/$SUITE/Release"
gpg --batch --yes --default-key "$KEY" -abs -o "dists/$SUITE/Release.gpg" "dists/$SUITE/Release"
gpg --batch --yes --default-key "$KEY" --clearsign -o "dists/$SUITE/InRelease" "dists/$SUITE/Release"
gpg --batch --yes --export "$KEY" > key.gpg
echo "apt repository ready in $REPO"
