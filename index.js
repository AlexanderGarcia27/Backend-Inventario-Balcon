const express = require("express");
const cors = require("cors");
const { db, admin } = require("./firebase"); // Asegúrate de que 'admin' y 'db' estén exportados

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------
// GENERAR CODIGO VENTA
// ----------------------
async function generarCodigoVenta() {
  const ventas = await db.collection("ventas").get();
  const total = ventas.size + 1;
  return "V" + String(total).padStart(3, "0");
}

// ----------------------------------------------
// CRUD PRODUCTOS (ACCESO ABIERTO)
// ----------------------------------------------

// Crear producto(s)
app.post("/productos", async (req, res) => {
  // ... (CÓDIGO SIN CAMBIOS) ...
  try {
    const productosParaGuardar = Array.isArray(req.body) ? req.body : [req.body];
    const snapshot = await db.collection("productos").get();
    let ultimoNumero = 0;
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.codigo) {
        const num = parseInt(data.codigo.replace("P", ""));
        if (num > ultimoNumero) ultimoNumero = num;
      }
    });

    const productosAgregados = [];
    let productosOmitidos = 0;

    for (const producto of productosParaGuardar) {
      if (!producto || !producto.nombre) {
        productosOmitidos++;
        continue;
      }

      ultimoNumero++;
      const nuevoCodigo = "P" + ultimoNumero.toString().padStart(3, "0");

      const nuevoProducto = {
        nombre: producto.nombre,
        precio: Number(producto.precio) || 0,
        precioCompra: Number(producto.precioCompra) || 0,
        categoria: producto.categoria || 'Sin Categoría',
        stock: Number(producto.stock) || 0,
        codigo: nuevoCodigo,
        creadoEn: new Date()
      };

      const productoRef = await db.collection("productos").add(nuevoProducto);

      productosAgregados.push({
        id: productoRef.id,
        nombre: nuevoProducto.nombre,
        codigo: nuevoCodigo
      });
    }

    if (productosAgregados.length === 0) {
      return res.status(400).json({ error: "No se encontró ningún producto válido para agregar." });
    }

    res.json({
      mensaje: "Productos agregados correctamente.",
      total_agregados: productosAgregados.length,
      total_omitidos: productosOmitidos,
      productos: productosAgregados
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al agregar productos" });
  }
});

// Listar productos
app.get("/productos", async (req, res) => {
  // ... (CÓDIGO SIN CAMBIOS) ...
  try {
    const snapshot = await db.collection("productos").get();
    const lista = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    lista.sort((a, b) => {
      const numA = parseInt(a.codigo.replace("P", ""));
      const numB = parseInt(b.codigo.replace("P", ""));
      return numA - numB;
    });

    res.json(lista);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Actualizar producto
app.put("/productos/:id", async (req, res) => {
  // ... (CÓDIGO SIN CAMBIOS) ...
  try {
    const updateData = { ...req.body };

    if (updateData.precio !== undefined) {
      updateData.precio = Number(updateData.precio) || 0;
    }
    if (updateData.stock !== undefined) {
      updateData.stock = Number(updateData.stock) || 0;
    }
    if (updateData.precioCompra !== undefined) {
      updateData.precioCompra = Number(updateData.precioCompra) || 0;
    }

    await db.collection("productos").doc(req.params.id).update(updateData);
    res.json({ mensaje: "Producto actualizado" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar producto
app.delete("/productos/:id", async (req, res) => {
  // ... (CÓDIGO SIN CAMBIOS) ...
  try {
    await db.collection("productos").doc(req.params.id).delete();
    res.json({ mensaje: "Producto eliminado" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------
// GESTIÓN DE DATOS PELIGROSA (BORRADO TOTAL - ACCESO ABIERTO)
// ----------------------------------------------

async function deleteCollection(collectionName) {
  // ... (CÓDIGO SIN CAMBIOS) ...
  const snapshot = await db.collection(collectionName).get();
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  return snapshot.size;
}

app.delete("/administracion/borrar-todo-peligro", async (req, res) => {
  // ... (CÓDIGO SIN CAMBIOS) ...
  try {
    console.log("INICIANDO BORRADO TOTAL DE DATOS...");
    const productosBorrados = await deleteCollection("productos");
    const ventasBoradas = await deleteCollection("ventas");
    console.log("BORRADO TOTAL FINALIZADO.");

    res.json({
      mensaje: "PELIGRO! Todas las colecciones han sido vaciadas.",
      detalle: {
        productos_eliminados: productosBorrados,
        ventas_eliminadas: ventasBoradas,
      },
    });
  } catch (error) {
    console.error("Error en el borrado total:", error);
    res.status(500).json({ error: "Error fatal al intentar borrar colecciones" });
  }
});

// ----------------------------------------------
// VENTAS (ADAPTADAS PARA CARRITO - ACCESO ABIERTO)
// ----------------------------------------------

// Crear una venta (Soporta MÚLTIPLES ARTÍCULOS)
app.post("/ventas", async (req, res) => {
  try {
    const { articulos, total, monto, cambio, nota } = req.body;

    if (!articulos || !Array.isArray(articulos) || articulos.length === 0 || total === undefined || monto === undefined) {
      return res.status(400).json({ error: "Faltan datos obligatorios o la lista de artículos está vacía." });
    }

    let costoVentaTotal = 0;
    const batch = db.batch();
    const articulosVentaFinal = [];

    for (const item of articulos) {
      const { productoId, cantidad, precioVenta } = item;

      const qty = Number(cantidad);
      const salePrice = Number(precioVenta);

      if (!productoId || qty <= 0 || salePrice <= 0 || isNaN(qty) || isNaN(salePrice)) {
        return res.status(400).json({ error: `Datos de artículo inválidos (ID: ${productoId}, Cantidad: ${cantidad}, Precio: ${precioVenta})` });
      }

      const productoRef = db.collection("productos").doc(productoId);
      const productoDoc = await productoRef.get();

      if (!productoDoc.exists) {
        return res.status(404).json({ error: `Producto no encontrado con ID: ${productoId}` });
      }

      const producto = productoDoc.data();

      if (producto.stock < qty) {
        return res.status(400).json({ error: `Stock insuficiente para el producto ${producto.nombre}. Disponible: ${producto.stock}, Solicitado: ${qty}` });
      }

      const precioCompraUnidad = producto.precioCompra || 0;
      const costoMercanciaVendidaArticulo = precioCompraUnidad * qty;
      costoVentaTotal += costoMercanciaVendidaArticulo;

      batch.update(productoRef, {
        stock: producto.stock - qty
      });

      articulosVentaFinal.push({
        productoId: productoId,
        cantidad: qty,
        precioVenta: salePrice,
        subtotal: qty * salePrice,
        costoUnitario: precioCompraUnidad,
      });
    }

    await batch.commit();

    const codigoVenta = await generarCodigoVenta();

    const gananciaTotal = Number(total) - costoVentaTotal;

    const ventaData = {
      codigo: codigoVenta,
      articulos: articulosVentaFinal,
      total: Number(total),
      monto: Number(monto),
      cambio: Number(cambio),
      costoVenta: costoVentaTotal,
      ganancia: gananciaTotal,
      nota: nota || "",
      // ***** AJUSTE CLAVE 1: GUARDAR COMO TIMESTAMP DE FIRESTORE *****
      fecha: admin.firestore.Timestamp.fromDate(new Date())
    };

    const ventaRef = await db.collection("ventas").add(ventaData);

    res.json({
      mensaje: "Venta registrada correctamente (Multi-artículo)",
      id: ventaRef.id,
      venta: ventaData
    });

  } catch (error) {
    console.error("Error al registrar venta multi-artículo:", error);
    res.status(500).json({ error: error.message || "Error desconocido al registrar la venta" });
  }
});

// Obtener todas las ventas (Listado resumido con filtro de fecha)
app.get("/ventas", async (req, res) => {
  try {
    const dateFilter = req.query.date; // Obtener el parámetro de la URL: ?date=YYYY-MM-DD
    let ventasQuery = db.collection("ventas");

    // ***** AJUSTE CLAVE 2: SE RESTABLECE EL FILTRO DE FECHA *****
    // Este filtro funcionará solo para las ventas que tienen el campo 'fecha'
    // como un Timestamp de Firestore.
    if (dateFilter) {
      // 1. Convertir la fecha YYYY-MM-DD a un objeto Date (inicio del día)
      const startOfDay = new Date(dateFilter);
      startOfDay.setHours(0, 0, 0, 0); // Establecer a la medianoche (00:00:00.000)

      // 2. Calcular el final del día
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1); // El día siguiente (ej. 00:00:00.000)

      // 3. Convertir a Timestamps para la consulta de Firestore
      const startTimestamp = admin.firestore.Timestamp.fromDate(startOfDay);
      const endTimestamp = admin.firestore.Timestamp.fromDate(endOfDay);

      // Aplicar el filtro 
      ventasQuery = ventasQuery
        .where("fecha", ">=", startTimestamp)
        .where("fecha", "<", endTimestamp);
    }
    // ***************************************************************

    // Opcional: Ordenar por fecha de la más reciente a la más antigua
    ventasQuery = ventasQuery.orderBy("fecha", "desc");

    const ventasSnapshot = await ventasQuery.get();

    // Obtener todos los productos para el resumen (sin filtro de fecha)
    const productosSnapshot = await db.collection("productos").get();
    const productosMap = {};
    productosSnapshot.docs.forEach(doc => {
      productosMap[doc.id] = doc.data();
    });

    const ventas = [];

    for (const doc of ventasSnapshot.docs) {
      const venta = doc.data();
      venta.id = doc.id;

      // Calcular la ganancia
      const costoVenta = venta.costoVenta || 0;
      venta.ganancia = parseFloat((venta.total - costoVenta).toFixed(2));

      // --- RESUMEN PARA LA TABLA PRINCIPAL ---
      const articulos = venta.articulos || [];

      if (articulos.length > 0) {
        const primerArticulo = articulos[0];
        const producto = productosMap[primerArticulo.productoId];
        const numArticulos = articulos.length;

        if (producto) {
          // Resumen: Primer producto + X más
          venta.productoNombre = numArticulos > 1 ? `${producto.nombre} (+${numArticulos - 1} más)` : producto.nombre;
          venta.productoCodigo = producto.codigo;
          venta.cantidad = `${numArticulos} artículos`;
        } else {
          venta.productoNombre = `Venta con ${numArticulos} artículos (Detalles no disponibles)`;
          venta.productoCodigo = "-";
          venta.cantidad = `${numArticulos} artículos`;
        }
      } else {
        // Manejo de ventas unitarias antiguas o errores (Legacy Support)
        const productoId = venta.productoId;
        const producto = productoId ? productosMap[productoId] : null;

        venta.productoNombre = producto ? producto.nombre : "Venta sin detalles";
        venta.productoCodigo = producto ? producto.codigo : "-";
        venta.cantidad = venta.cantidad || 1;
      }
      // --------------------------------------------------

      ventas.push(venta);
    }

    res.json(ventas);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener una venta específica (Detalle)
app.get("/ventas/:id", async (req, res) => {
  // ... (CÓDIGO SIN CAMBIOS) ...
  try {
    const id = req.params.id;

    const ventaSnapshot = await db.collection("ventas").doc(id).get();

    if (!ventaSnapshot.exists) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }

    const venta = ventaSnapshot.data();

    // Calcular la ganancia
    const costoVenta = venta.costoVenta || 0;
    venta.ganancia = parseFloat((venta.total - costoVenta).toFixed(2));

    return res.json(venta);
  } catch (error) {
    console.error("Error al obtener la venta:", error);
    return res.status(500).json({ error: "Error al obtener la venta" });
  }
});


// ------------------------------
// LOGIN y DASHBOARD (SIN SEGURIDAD)
// ------------------------------

app.post('/login', async (req, res) => {
  // ... (CÓDIGO SIN CAMBIOS) ...
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({ error: "Faltan credenciales" });
    }

    const ref = db.collection('usuarios');
    const query = await ref.where("usuario", "==", usuario).get();

    if (query.empty) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const userDoc = query.docs[0].data();

    if (userDoc.password !== password) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    return res.json({
      mensaje: "Inicio de sesión exitoso",
      token: 'token_sin_uso',
      rol: userDoc.rol
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/dashboard/totales", async (req, res) => {
  // ... (CÓDIGO SIN CAMBIOS) ...
  try {
    const productosSnapshot = await db.collection("productos").get();
    const totalProductos = productosSnapshot.size;

    const productosStockBajo = productosSnapshot.docs.filter(
      doc => doc.data().stock < 10
    ).length;

    const hoy = new Date();
    const hace7dias = new Date();
    hace7dias.setDate(hoy.getDate() - 7);

    const ventasSnapshot = await db.collection("ventas").get();

    let ventasUltimos7Dias = 0;

    ventasSnapshot.forEach(doc => {
      const venta = doc.data();

      // Aseguramos que solo procesamos fechas válidas y de tipo Timestamp
      if (venta.fecha && venta.fecha.toDate) {
        const fechaVenta = venta.fecha.toDate();
        if (fechaVenta >= hace7dias) {
          ventasUltimos7Dias += venta.total;
        }
      }
    });

    res.json({
      totalProductos,
      productosStockBajo,
      ventasUltimos7Dias: ventasUltimos7Dias.toFixed(2)
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------
const PORT = 3000;
app.listen(PORT, () => console.log("API lista en puerto", PORT));