export async function verifyUrl(url: string): Promise<boolean> {
    try {
        // 1. Teste primário ultraleve que não baixa o corpo da resposta
        const headResponse = await fetch(url, {
            method: "HEAD",
            headers: { "User-Agent": "Waranas-IPTV-Checker" }
        });

        if (headResponse.ok) return true;

        // 2. Callback de teste GET com limite estrito de banda
        const getResponse = await fetch(url, {
            method: "GET",
            headers: {
                "Range": "bytes=0-0",
                "User-Agent": "Waranas-IPTV-Checker"
            }
        });

        // Considera HTTP 200 (OK) ou 206 (Partial Content gerado pelo header Range) como válidos
        return getResponse.ok || getResponse.status === 206;
    } catch (error) {
        console.warn(`[verifyChannelUrl] URL offline ou inacessível (${url})`);
        return false;
    }
}
