export async function copySiteUrl(url, toast, t) {
  try {
    await navigator.clipboard.writeText(url);
    toast({ title: t.linkCopiedTitle, description: t.linkCopiedDesc });
    return true;
  } catch {
    toast({ title: t.copyFailedTitle, variant: "destructive" });
    return false;
  }
}
