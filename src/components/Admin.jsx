import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient"; // ajusta ruta si hace falta
import { storage } from "../firebase/firebase";
import {
  ref,
  listAll,
  getDownloadURL,
  deleteObject,
  getBlob,
} from "firebase/storage";

const Admin = () => {
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const [photos, setPhotos] = useState([]);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [selectAll, setSelectAll] = useState(false);

  // ===== checkIfAdmin: acepta user opcional o consulta la sesión si no se pasa =====
  const checkIfAdmin = async (userParam) => {
    try {
      let user = userParam;
      if (!user) {
        const { data: sessionData } = await supabase.auth.getSession();
        user = sessionData?.session?.user ?? sessionData?.user ?? null;
      }

      if (!user || !user.email) {
        console.log("⚠️ checkIfAdmin: no hay usuario válido");
        setIsAdmin(false);
        return false;
      }

      const email = (user.email || "").toLowerCase().trim();
      console.log("🔍 Buscando en admins (email):", email);

      const { data: admin, error: adminError } = await supabase
        .from("admins")
        .select("id, email")
        .eq("email", email)
        .maybeSingle();

      console.log("Resultado admin:", admin, " error:", adminError ?? null);

      if (adminError) {
        // si hay un error explícito lo mostramos y salimos
        console.error("❌ adminError:", adminError);
        setIsAdmin(false);
        return false;
      }

      setIsAdmin(!!admin);
      return !!admin;
    } catch (err) {
      console.error("❌ Error al verificar el rol de admin:", err);
      setIsAdmin(false);
      return false;
    }
  };

  // ===== Inicialización y escucha de cambios de sesión =====
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(async (event, sessionObj) => {
      console.log("onAuthStateChange:", event, sessionObj?.user?.email ?? null);
      setSession(sessionObj?.session ?? sessionObj ?? null);

      if (event === "SIGNED_IN" && (sessionObj?.user ?? sessionObj?.session?.user)) {
        // pasa el user directo para evitar lecturas redundantes
        const user = sessionObj.user ?? sessionObj.session?.user;
        await checkIfAdmin(user);
        setLoading(false);
      }

      if (event === "SIGNED_OUT") {
        setIsAdmin(false);
        setSession(null);
        setLoading(false);
      }
    });

    // carga inicial de sesión
    const getInitialSession = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const currentSession = sessionData?.session ?? sessionData ?? null;
        setSession(currentSession);
        if (currentSession && (currentSession.user ?? currentSession.session?.user)) {
          const user = currentSession.user ?? currentSession.session?.user;
          await checkIfAdmin(user);
        } else {
          setIsAdmin(false);
        }
      } catch (err) {
        console.error("❌ getInitialSession error:", err);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    };

    getInitialSession();

    return () => {
      data.subscription?.unsubscribe?.();
    };
  }, []);

  // ===== fotos sólo si es admin =====
  const fetchPhotos = async () => {
    try {
      console.log("📁 fetchPhotos: iniciando...");
      const listRef = ref(storage, "photos/");
      const result = await listAll(listRef);
      const urls = await Promise.all(
        result.items.map(async (item) => ({
          name: item.name,
          url: await getDownloadURL(item),
        }))
      );
      setPhotos(urls.reverse());
      console.log("📁 fetchPhotos: cargadas:", urls.length);
    } catch (error) {
      console.error("❌ Error cargando fotos:", error);
    }
  };

  useEffect(() => {
    if (isAdmin) fetchPhotos();
  }, [isAdmin]);

  // ===== resto de utilidades (delete/download) =====
  const handleDelete = async (name) => {
    try {
      const photoRef = ref(storage, `photos/${name}`);
      await deleteObject(photoRef);
      setPhotos((prev) => prev.filter((photo) => photo.name !== name));
      setSelectedPhoto(null);
      setConfirmDelete(null);
      setSelectedPhotos((prev) => prev.filter((n) => n !== name));
    } catch (error) {
      console.error("❌ Error al eliminar:", error);
    }
  };

  const handleDownload = async (fileName) => {
    try {
      const fileRef = ref(storage, `photos/${fileName}`);
      const blob = await getBlob(fileRef);
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("❌ Error descargando la foto:", error);
    }
  };

  const handleDownloadSelected = async () => {
    for (const name of selectedPhotos) {
      await handleDownload(name);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + "/admin",
        },
      });
      if (error) console.error("❌ Error de autenticación:", error);
    } catch (error) {
      console.error("❌ Error de autenticación:", error);
    }
  };

  // ===== UI =====
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <h1 className="text-white text-2xl">Cargando...</h1>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <button
          onClick={handleGoogleSignIn}
          className="px-6 py-3 bg-blue-500 text-white font-bold rounded-lg shadow-md hover:bg-blue-600 transition"
        >
          Iniciar sesión con Google
        </button>
      </div>
    );
  }

  if (session && !isAdmin) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen gap-4">
        <h1 className="text-white text-2xl">Acceso denegado.</h1>
        <p className="text-sm text-gray-300">Usuario: {session.user?.email ?? "sin email"}</p>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            setIsAdmin(false);
            setSession(null);
          }}
          className="px-4 py-2 bg-gray-700 text-white rounded"
        >
          Cerrar sesión
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6" style={{ backgroundImage: "url('/anillos.jpg')" }}>
      <h1 className="text-3xl font-bold text-white mb-6 mt-8 text-center">Dashboard Admin</h1>
      <h2 className="font-semibold text-white text-center mb-6 flex justify-center items-center gap-6">
        Total fotos: {photos.length}
        {photos.length > 0 && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectAll}
              onChange={(e) => {
                const checked = e.target.checked;
                setSelectAll(checked);
                setSelectedPhotos(checked ? photos.map((p) => p.name) : []);
              }}
            />
            Seleccionar todo
          </label>
        )}
      </h2>

      {selectedPhotos.length > 0 && (
        <div className="text-center mb-6 flex justify-center gap-4">
          <button onClick={() => setConfirmDelete(selectedPhotos)} className="px-4 py-2 bg-red-400 text-white rounded">
            Eliminar ({selectedPhotos.length})
          </button>
          <button onClick={handleDownloadSelected} className="px-4 py-2 bg-green-600 text-white rounded">
            Descargar ({selectedPhotos.length})
          </button>
        </div>
      )}

      {photos.length === 0 ? (
        <p className="text-center text-gray-300">No hay fotos aún.</p>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {photos.map((photo, index) => (
            <div key={index} className="relative group w-full aspect-square overflow-hidden rounded-md shadow-md">
              <img src={photo.url} alt={`Foto ${index + 1}`} className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} onClick={() => setSelectedPhoto(photo)} />
              <input type="checkbox" className="absolute bottom-20 left-0 w-5 h-5" checked={selectedPhotos.includes(photo.name)} onChange={(e) => {
                if (e.target.checked) setSelectedPhotos(prev => [...prev, photo.name]);
                else { setSelectedPhotos(prev => prev.filter(n => n !== photo.name)); setSelectAll(false); }
              }} />
              <div className="absolute top-2 right-2 flex gap-8 mt-14">
                <img src="/descargar.png" alt="Descargar" className="w-8 h-8 cursor-pointer rounded-full p-1 bg-white" onClick={() => handleDownload(photo.name)} />
                <img src="/borrar.png" alt="Eliminar" className="w-8 h-8 cursor-pointer rounded-full p-1 bg-white" onClick={() => setConfirmDelete(photo)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedPhoto && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="relative">
            <img src={selectedPhoto.url} alt="Foto ampliada" className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-lg" style={{ transform: "scaleX(-1)" }} />
            <div className="absolute top-4 right-4 flex gap-4">
              <img src="/descargar.png" alt="Descargar" className="w-10 h-10 cursor-pointer rounded-full p-2 bg-white" onClick={() => handleDownload(selectedPhoto.name)} />
              <img src="/borrar.png" alt="Eliminar" className="w-10 h-10 cursor-pointer rounded-full p-2 bg-white" onClick={() => setConfirmDelete(selectedPhoto)} />
            </div>
            <button className="absolute top-4 left-4 text-white text-xl bg-black/50 px-3 py-1 rounded" onClick={() => setSelectedPhoto(null)}>✕</button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-lg p-6 relative max-w-sm w-full text-center">
            <h2 className="text-lg font-bold text-gray-800 mb-4">{Array.isArray(confirmDelete) ? `Estás a punto de eliminar ${confirmDelete.length} fotos` : "Estás a punto de eliminar esta foto"}</h2>
            <div className="flex justify-center gap-4">
              <button className="px-4 py-2 bg-red-500 text-white rounded" onClick={async () => {
                if (Array.isArray(confirmDelete)) { for (const name of confirmDelete) await handleDelete(name); setSelectedPhotos([]); setSelectAll(false); } else await handleDelete(confirmDelete.name);
                setConfirmDelete(null);
              }}>Confirmar</button>
              <button className="px-4 py-2 bg-gray-300 rounded" onClick={() => setConfirmDelete(null)}>✕</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin;
