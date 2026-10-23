#!/bin/sh
# Proves the .deb and the apt repository work: builds a repo with a throw-away key,
# installs the package through apt from it and starts the program. Run as root (CI: sudo).
#   check-apt.sh <dir with the .deb for this machine>
set -e
DEBS=$1
WORK=$(mktemp -d)
export GNUPGHOME="$WORK/gnupg"; mkdir -m 700 "$GNUPGHOME"
gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key "ZebraApp test <test@example.invalid>" rsa2048 sign never 2>/dev/null
KEY=$(gpg --list-keys --with-colons | awk -F: '/^fpr/ {print $10; exit}')
sh "$(dirname "$0")/make-apt-repo.sh" "$DEBS" "$WORK/repo" "$KEY"
# apt reads the repository as the unprivileged user _apt
chmod 755 "$WORK"; chmod -R a+rX "$WORK/repo"
echo "deb [signed-by=$WORK/repo/key.gpg] file:$WORK/repo stable main" > /etc/apt/sources.list.d/zebraapp-test.list
apt-get update -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/zebraapp-test.list -o Dir::Etc::sourceparts=/dev/null
apt-get install -y --no-install-recommends zebraapp
zebraapp --version
apt-get remove -y zebraapp
rm -f /etc/apt/sources.list.d/zebraapp-test.list
echo "apt check passed"
