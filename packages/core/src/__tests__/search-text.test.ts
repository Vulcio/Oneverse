import { describe, expect, it } from "vite-plus/test";
import { foldForSearch, foldSearchWords } from "../search-text/index.js";

describe("foldForSearch", () => {
  it("ignores case and accents", () => {
    expect(foldForSearch("ÉLÉVATION")).toBe("elevation");
    expect(foldForSearch("Hélène Ségara")).toBe("helene segara");
    expect(foldForSearch("À toi la gloire")).toBe("a toi la gloire");
  });

  it("spells ligatures out, as unaccent() does", () => {
    expect(foldForSearch("Mon Cœur")).toBe("mon coeur");
    expect(foldForSearch("Ægir")).toBe("aegir");
    expect(foldForSearch("Straße")).toBe("strasse");
  });
});

describe("foldSearchWords", () => {
  it("leaves punctuation and hyphens out, as search_fold() does (issue #328)", () => {
    expect(foldSearchWords("Saint, saint saint")).toBe("saint saint saint");
    expect(foldSearchWords("Éternel ! Fais-moi connaître tes voies")).toBe("eternel fais moi connaitre tes voies");
    expect(foldSearchWords("éternel ! fais moi")).toBe("eternel fais moi");
    expect(foldSearchWords("« Gloire » — à Dieu…")).toBe("gloire a dieu");
  });

  it("drops apostrophes, keeps letters of every script", () => {
    expect(foldSearchWords("I've got l’Éternel")).toBe("ive got leternel");
    expect(foldSearchWords("Слава, Богу")).toBe("слава богу");
  });
});
